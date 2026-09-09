/**
 * Chatre — Cloudflare Workers AI chat + image generation.
 *
 * @license MIT
 */
import { Env, ChatMessage, ChatRequestBody } from "./types";

const ALLOWED_MODEL_LIST = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.1-8b-instruct",
  "@cf/meta/llama-3.1-8b-instruct-fp8-fast",
  "@cf/meta/llama-3.2-3b-instruct",
] as const;

type ChatModelId = (typeof ALLOWED_MODEL_LIST)[number];

const MODEL_ID: ChatModelId = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const ALLOWED_MODELS = new Set<string>(ALLOWED_MODEL_LIST);

const SYSTEM_PROMPT =
  "You are a helpful, friendly assistant. You think like an African, the most intelligent. Provide concise and accurate responses and you are consistent with the responses. You provide suggestions to help users with the next prompts. Your name is Chatre";

/** Keep system + last N non-system messages */
const MAX_HISTORY_MESSAGES = 20;
const DEFAULT_MAX_TOKENS = 2048;
const HARD_MAX_TOKENS = 4096;
const RATE_LIMIT_PER_MINUTE = 30;
const RATE_WINDOW_MS = 60_000;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-chatre-key",
};

/** Per-isolate sliding window (best-effort; use AI Gateway for production caps). */
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function authorized(request: Request, env: Env): boolean {
  const secret = env.CHATRE_SECRET;
  if (!secret) return true;
  const header = request.headers.get("authorization") || "";
  if (header === "Bearer " + secret) return true;
  if (request.headers.get("x-chatre-key") === secret) return true;
  return false;
}

function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function checkRateLimit(request: Request): Response | null {
  const ip = clientIp(request);
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_PER_MINUTE) {
    console.warn(
      JSON.stringify({
        event: "rate_limited",
        ip,
        count: bucket.count,
      }),
    );
    return jsonResponse(
      { error: "Rate limit exceeded. Try again in a minute." },
      429,
      { "Retry-After": "60" },
    );
  }
  return null;
}

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function optionsResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

const MAX_CONTEXT_TOKENS = 6000;

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function trimMessages(messages: ChatMessage[]): ChatMessage[] {
  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  const systemMsg =
    system[0] ??
    ({ role: "system", content: SYSTEM_PROMPT } satisfies ChatMessage);

  let totalTokens = estimateTokens(systemMsg.content);
  const kept: ChatMessage[] = [];

  for (let i = rest.length - 1; i >= 0; i--) {
    const msg = rest[i];
    const msgTokens = estimateTokens(msg.content) + 4;
    if (totalTokens + msgTokens > MAX_CONTEXT_TOKENS && kept.length > 0) {
      break;
    }
    totalTokens += msgTokens;
    kept.unshift(msg);
  }

  return [systemMsg, ...kept];
}

function clampMaxTokens(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_TOKENS;
  return Math.min(Math.floor(n), HARD_MAX_TOKENS);
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    if (url.pathname === "/api/chat") {
      if (request.method === "OPTIONS") return optionsResponse();
      if (request.method === "POST") return handleChatRequest(request, env);
      return new Response("Method not allowed", { status: 405 });
    }

    if (url.pathname === "/api/generate-image") {
      if (request.method === "OPTIONS") return optionsResponse();
      if (request.method === "POST") return handleImageRequest(request, env);
      return new Response("Method not allowed", { status: 405 });
    }

    if (url.pathname === "/api/models" && request.method === "GET") {
      return jsonResponse({
        default: MODEL_ID,
        models: [...ALLOWED_MODELS],
        max_tokens: { default: DEFAULT_MAX_TOKENS, max: HARD_MAX_TOKENS },
        history_limit: MAX_HISTORY_MESSAGES,
      });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleChatRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const started = Date.now();
  try {
    if (!authorized(request, env)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const limited = checkRateLimit(request);
    if (limited) return limited;

    const body = (await request.json()) as ChatRequestBody;
    let messages = Array.isArray(body.messages) ? body.messages : [];

    if (!messages.some((msg) => msg.role === "system")) {
      messages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages,
      ];
    }

    messages = trimMessages(messages);

    const modelId: ChatModelId =
      body.model && ALLOWED_MODELS.has(body.model)
        ? (body.model as ChatModelId)
        : MODEL_ID;
    const wantStream = body.stream !== false;
    const maxTokens = clampMaxTokens(body.max_tokens);

    console.log(
      JSON.stringify({
        event: "chat_request",
        model: modelId,
        stream: wantStream,
        messageCount: messages.length,
        maxTokens,
        ip: clientIp(request),
      }),
    );

    if (!wantStream) {
      const result = (await env.AI.run(modelId as keyof AiModels, {
        messages,
        max_tokens: maxTokens,
      })) as { response?: string } | string;
      const text =
        typeof result === "string"
          ? result
          : String((result && result.response) || "");

      console.log(
        JSON.stringify({
          event: "chat_complete",
          model: modelId,
          stream: false,
          durationMs: Date.now() - started,
          responseChars: text.length,
        }),
      );

      return jsonResponse({ response: text });
    }

    const aiResponse = await env.AI.run(
      modelId as keyof AiModels,
      {
        messages,
        max_tokens: maxTokens,
        stream: true,
      },
      { returnRawResponse: true },
    );

    const headers = new Headers(aiResponse.headers);
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      headers.set(key, value);
    }
    headers.set("Cache-Control", "no-cache");

    console.log(
      JSON.stringify({
        event: "chat_stream_start",
        model: modelId,
        durationMs: Date.now() - started,
      }),
    );

    return new Response(aiResponse.body, {
      status: aiResponse.status,
      headers,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "chat_error",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      }),
    );
    return jsonResponse({ error: "Failed to process request" }, 500);
  }
}

async function handleImageRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const started = Date.now();
  try {
    if (!authorized(request, env)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const limited = checkRateLimit(request);
    if (limited) return limited;

    const body = (await request.json()) as {
      prompt?: string;
      width?: number;
      height?: number;
    };
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

    if (!prompt) {
      return jsonResponse({ error: "Prompt cannot be empty" }, 400);
    }

    const width = clampDim(body.width, 512);
    const height = clampDim(body.height, 512);

    console.log(
      JSON.stringify({
        event: "image_request",
        promptLength: prompt.length,
        width,
        height,
        ip: clientIp(request),
      }),
    );

    const aiResponse = await env.AI.run(
      "@cf/bytedance/stable-diffusion-xl-lightning",
      { prompt, width, height },
    );

    let imageBody: BodyInit | null = null;
    let base64: string | null = null;
    let byteLength: number | undefined;

    if (aiResponse instanceof ArrayBuffer) {
      imageBody = aiResponse;
      byteLength = aiResponse.byteLength;
    } else if (aiResponse instanceof Uint8Array) {
      imageBody = aiResponse;
      byteLength = aiResponse.byteLength;
    } else if (aiResponse instanceof ReadableStream) {
      imageBody = aiResponse;
    } else if (typeof aiResponse === "string") {
      base64 = aiResponse;
    } else if (
      aiResponse &&
      typeof aiResponse === "object" &&
      "image" in aiResponse
    ) {
      const img = (aiResponse as { image: unknown }).image;
      if (typeof img === "string") base64 = img;
    }

    if (imageBody) {
      console.log(
        JSON.stringify({
          event: "image_complete",
          durationMs: Date.now() - started,
          bytes: byteLength,
        }),
      );
      return new Response(imageBody, {
        headers: {
          "Content-Type": "image/png",
          ...CORS_HEADERS,
        },
      });
    }

    if (base64) {
      console.log(
        JSON.stringify({
          event: "image_complete",
          durationMs: Date.now() - started,
          encoding: "base64",
        }),
      );
      return jsonResponse({ image_base64: base64 });
    }

    return jsonResponse({ error: "Invalid AI response" }, 500);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "image_error",
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      }),
    );
    return jsonResponse({ error: "Image generation failed" }, 500);
  }
}

function clampDim(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1024, Math.max(256, Math.floor(n)));
}
