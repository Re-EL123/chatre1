/**
 * Chatre — Cloudflare Workers AI chat + image generation + browser automation.
 *
 * @license MIT
 */
import { Env, ChatMessage, ChatRequestBody } from "./types";
import { handleBrowserRequest } from "./browser";
import { AGENT_SYSTEM_PROMPT } from "./agent-prompt";
import { ANALYST_SYSTEM_PROMPT } from "./analyst-prompt";

const CRITIC_SYSTEM_PROMPT = `You are Chatre's critic. Decide if the executor finished the user's request.
Output ONLY JSON: {"pass":true|false,"score":0-100,"gaps":["..."],"fix_brief":"..."}.
Be strict about success criteria. You are Chatre — never mention other products.`;

export { BrowserSessionDO } from "./session-do";

const ALLOWED_MODEL_LIST = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.1-8b-instruct",
  "@cf/meta/llama-3.1-8b-instruct-fp8-fast",
  "@cf/meta/llama-3.2-3b-instruct",
] as const;

type ChatModelId = (typeof ALLOWED_MODEL_LIST)[number];

const MODEL_ID: ChatModelId = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const ALLOWED_MODELS = new Set<string>(ALLOWED_MODEL_LIST);

const CHAT_SYSTEM_PROMPT =
  "You are Chatre, a helpful, friendly assistant. You think like an African, the most intelligent. Provide concise and accurate responses. Suggest useful next prompts. Your name is Chatre.";

const SYSTEM_PROMPT = AGENT_SYSTEM_PROMPT;

/** Keep system + last N non-system messages */
const MAX_HISTORY_MESSAGES = 20;
const DEFAULT_MAX_TOKENS = 2048;
const HARD_MAX_TOKENS = 4096;
const RATE_LIMIT_PER_MINUTE = 120;
const RATE_WINDOW_MS = 60_000;
const AI_MAX_RETRIES = 3;

const BYOK_MODEL_PREFIX =
  /^(openrouter|anthropic|openai|google):/i;

function formatWorkersAiError(raw: string, status: number): string {
  const text = String(raw || "").trim();
  if (!text) {
    return status === 429
      ? "Workers AI free daily quota is exhausted. Select an OpenRouter (or other BYOK) model after saving a key in Settings, or wait until the quota resets."
      : "Workers AI returned " + status + ".";
  }
  try {
    const j = JSON.parse(text) as {
      description?: string;
      message?: string;
      httpCode?: number;
    };
    const desc = j.description || j.message || text;
    if (status === 429 || j.httpCode === 429 || /neurons|quota|429/i.test(desc)) {
      return (
        "Workers AI free quota exhausted (10k neurons/day). " +
        "Your selected BYOK model was not used — pick an openrouter:… model while signed in, " +
        "or wait for the daily reset / upgrade Workers Paid. Details: " +
        desc
      );
    }
    return desc;
  } catch {
    if (status === 429 || /neurons|quota/i.test(text)) {
      return (
        "Workers AI free quota exhausted. Use a BYOK OpenRouter model (Settings → BYOK) while signed in, or wait for the daily reset."
      );
    }
    return text.length > 400 ? text.slice(0, 400) + "…" : text;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(retryAfter: string | null, attempt: number): number {
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, 30_000);
    }
  }
  return Math.min(1000 * 2 ** attempt, 8_000);
}

/**
 * Retry an AI binding call when Workers AI returns/throws HTTP 429 (its own
 * per-minute caps, independent of the daily neuron quota). Honors the
 * upstream Retry-After header so bursts self-heal instead of failing.
 */
async function aiRunWithRetry(
  fn: () => Promise<Response>,
): Promise<Response> {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt <= AI_MAX_RETRIES; attempt++) {
    try {
      lastResponse = await fn();
      if (lastResponse.status !== 429) return lastResponse;
    } catch (error) {
      const status = statusOf(error);
      if (status !== 429) throw error;
      lastResponse = null;
    }
    if (attempt >= AI_MAX_RETRIES) break;
    const retryAfter = lastResponse
      ? lastResponse.headers.get("retry-after")
      : null;
    const delayMs = retryDelayMs(retryAfter, attempt);
    console.warn(
      JSON.stringify({
        event: "ai_rate_limited",
        attempt: attempt + 1,
        retryAfterMs: delayMs,
      }),
    );
    await sleep(delayMs);
  }
  return lastResponse ?? new Response("Rate limited", { status: 429 });
}

function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object") {
    const obj = error as { status?: unknown; statusCode?: unknown };
    const n = typeof obj.status === "number" ? obj.status : obj.statusCode;
    if (typeof n === "number") return n;
  }
  return undefined;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

function checkRateLimit(request: Request, env: Env): Response | null {
  // Trusted first-party callers (requests carrying the shared secret) are
  // exempt from the per-IP cap — they're not a single browser session.
  if (env.CHATRE_SECRET) {
    const auth = request.headers.get("authorization") || "";
    if (auth === "Bearer " + env.CHATRE_SECRET) return null;
    if (request.headers.get("x-chatre-key") === env.CHATRE_SECRET) return null;
  }
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

const MAX_CONTEXT_TOKENS = 24000;

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

    if (url.pathname === "/api/firebase-config") {
      if (request.method === "OPTIONS") return optionsResponse();
      if (request.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
      }
      // Web API keys are designed to ship in clients; restrict by Authorized domains in Firebase.
      const apiKey = String(env.FIREBASE_API_KEY || "").trim();
      if (!apiKey) {
        return jsonResponse({ configured: false }, 200);
      }
      return jsonResponse(
        {
          configured: true,
          apiKey,
          authDomain:
            String(env.FIREBASE_AUTH_DOMAIN || "").trim() ||
            "re-el-eed0d.firebaseapp.com",
          projectId:
            String(env.FIREBASE_PROJECT_ID || "").trim() || "re-el-eed0d",
          appId: String(env.FIREBASE_APP_ID || "").trim() || "",
        },
        200,
      );
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

    if (url.pathname === "/api/browser") {
      if (request.method === "OPTIONS") return optionsResponse();
      if (request.method === "POST") {
        if (!authorized(request, env)) {
          return jsonResponse({ error: "Unauthorized" }, 401);
        }
        const limited = checkRateLimit(request, env);
        if (limited) return limited;
        return handleBrowserRequest(request, env);
      }
      return new Response("Method not allowed", { status: 405 });
    }

    if (url.pathname === "/api/browser/health") {
      if (request.method === "OPTIONS") return optionsResponse();
      if (request.method === "GET" || request.method === "POST") {
        return jsonResponse({
          ok: true,
          browser_binding: !!env.BROWSER,
          sessions_binding: !!env.BROWSER_SESSIONS,
          ai_binding: !!env.AI,
          brave_configured: !!env.BRAVE_API_KEY,
          note: env.BROWSER
            ? "Browser Rendering bound — computer-use tools available"
            : "Browser Rendering not bound — enable in Cloudflare dashboard + wrangler.jsonc",
        });
      }
      return new Response("Method not allowed", { status: 405 });
    }

    if (url.pathname === "/api/mcp") {
      if (request.method === "OPTIONS") return optionsResponse();
      if (request.method === "POST") return handleMcpRequest(request, env);
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

    const limited = checkRateLimit(request, env);
    if (limited) return limited;

    const body = (await request.json()) as ChatRequestBody;

    if (body.model && BYOK_MODEL_PREFIX.test(String(body.model))) {
      return jsonResponse(
        {
          error:
            "Model " +
            body.model +
            " is a BYOK provider model. It must run through the Chatre API (sign in + Settings → BYOK). " +
            "This Worker only serves Cloudflare Workers AI models and will not fall back to them for BYOK selections.",
        },
        400,
      );
    }

    const mode =
      body.mode === "analyst" ||
      body.mode === "agent" ||
      body.mode === "chat" ||
      body.mode === "critic"
        ? body.mode
        : body.agent === true
          ? "agent"
          : "chat";
    const agentMode = mode === "agent";
    const systemPrompt =
      mode === "analyst"
        ? ANALYST_SYSTEM_PROMPT
        : mode === "critic"
          ? CRITIC_SYSTEM_PROMPT
          : mode === "agent"
            ? AGENT_SYSTEM_PROMPT
            : CHAT_SYSTEM_PROMPT;

    // Never trust client-supplied system messages — always inject ours.
    let messages = (Array.isArray(body.messages) ? body.messages : []).filter(
      (m) => m && m.role !== "system",
    );
    messages = [{ role: "system", content: systemPrompt }, ...messages];
    messages = trimMessages(messages);

    const modelId: ChatModelId =
      body.model && ALLOWED_MODELS.has(body.model)
        ? (body.model as ChatModelId)
        : MODEL_ID;
    const tools =
      mode === "analyst" || mode === "critic"
        ? null
        : Array.isArray(body.tools)
          ? body.tools
          : null;
    const wantStream =
      body.stream !== false && !tools && mode !== "analyst" && mode !== "critic";
    const maxTokens = clampMaxTokens(
      body.max_tokens ??
        (mode === "analyst" || mode === "critic"
          ? 2048
          : agentMode
            ? 3072
            : DEFAULT_MAX_TOKENS),
    );

    console.log(
      JSON.stringify({
        event: "chat_request",
        model: modelId,
        stream: wantStream,
        agent: agentMode,
        mode,
        tools: tools ? tools.length : 0,
        messageCount: messages.length,
        maxTokens,
        ip: clientIp(request),
      }),
    );

    if (!wantStream) {
      let runInput: Record<string, unknown> = {
        messages,
        max_tokens: maxTokens,
      };
      if (tools && tools.length) {
        runInput.tools = tools;
      }

      let aiResponse = await aiRunWithRetry(() =>
        env.AI.run(modelId as keyof AiModels, runInput as never, {
          returnRawResponse: true,
        }),
      );

      // Some models reject tools — retry without them (but not on 429s;
      // those are already retried by aiRunWithRetry and are rate-limit errors,
      // not tool-rejection errors).
      if (!aiResponse.ok && aiResponse.status !== 429 && tools && tools.length) {
        console.warn(
          JSON.stringify({
            event: "chat_tools_fallback",
            status: aiResponse.status,
          }),
        );
        runInput = { messages, max_tokens: maxTokens };
        aiResponse = await aiRunWithRetry(() =>
          env.AI.run(modelId as keyof AiModels, runInput as never, {
            returnRawResponse: true,
          }),
        );
      }

      if (!aiResponse.ok) {
        const bodyText = await aiResponse.text().catch(() => "");
        console.error(
          JSON.stringify({
            event: "chat_non_stream_error",
            status: aiResponse.status,
            body: bodyText.slice(0, 500),
          }),
        );
        return jsonResponse(
          {
            error: formatWorkersAiError(bodyText, aiResponse.status),
          },
          aiResponse.status,
        );
      }

      const result = (await aiResponse.json()) as unknown;
      const parsed = normalizeChatResult(result);
      console.log(
        JSON.stringify({
          event: "chat_complete",
          model: modelId,
          stream: false,
          durationMs: Date.now() - started,
          responseChars: parsed.response.length,
          toolCalls: parsed.tool_calls.length,
        }),
      );

      return jsonResponse(parsed);
    }

    const aiResponse = await aiRunWithRetry(() =>
      env.AI.run(
        modelId as keyof AiModels,
        {
          messages,
          max_tokens: maxTokens,
          stream: true,
        },
        { returnRawResponse: true },
      ),
    );

    if (!aiResponse.ok) {
      const bodyText = await aiResponse.text().catch(() => "");
      console.error(
        JSON.stringify({
          event: "chat_stream_error",
          status: aiResponse.status,
          body: bodyText.slice(0, 500),
        }),
      );
      return jsonResponse(
        {
          error: formatWorkersAiError(bodyText, aiResponse.status),
        },
        aiResponse.status,
      );
    }

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

interface McpRequestBody {
  endpoint?: string;
  /** MCP JSON-RPC method: "tools/call" (default) or "tools/list". */
  method?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
}

/**
 * CORS-safe relay to external MCP (Model Context Protocol) endpoints.
 * The browser can't fetch these directly (no CORS headers), so the Worker
 * POSTs a JSON-RPC 2.0 request upstream and forwards the JSON or the last
 * SSE event. Credentials stay on the user's side for now (endpoint auth is
 * passed through in the request from the client when configured).
 */
async function handleMcpRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const started = Date.now();
  try {
    if (!authorized(request, env)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const limited = checkRateLimit(request, env);
    if (limited) return limited;

    const body = (await request.json()) as McpRequestBody;
    const endpoint = String(body.endpoint || "").trim();
    if (!/^https:\/\//i.test(endpoint)) {
      return jsonResponse({ error: "endpoint must be an https URL" }, 400);
    }

    const method =
      body.method === "tools/list" ? "tools/list" : "tools/call";
    const payload = {
      jsonrpc: "2.0",
      id: 1,
      method,
      params:
        method === "tools/list"
          ? {}
          : { name: body.tool, arguments: body.arguments || {} },
    };

    // Forward any client-provided auth headers (e.g. x-api-key) set by the
    // connector card, so the upstream endpoint can authenticate the user.
    const forwardHeaders: Record<string, string> = {};
    for (const key of ["x-api-key", "authorization", "x-chatre-key"]) {
      const v = request.headers.get(key);
      if (v) forwardHeaders[key] = v;
    }

    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "user-agent": "Chatre/1.0",
        ...forwardHeaders,
      },
      body: JSON.stringify(payload),
    });

    const ct = upstream.headers.get("content-type") || "";
    let result: unknown = null;
    if (ct.includes("text/event-stream")) {
      const raw = await upstream.text();
      for (const line of raw.split("\n")) {
        const m = line.match(/^data:\s*(.*)$/);
        if (m && m[1]) {
          try {
            result = JSON.parse(m[1]);
          } catch {
            /* non-JSON SSE frame — keep last */
          }
        }
      }
    } else {
      try {
        result = await upstream.json();
      } catch {
        result = { ok: false, error: "Non-JSON response from " + endpoint };
      }
    }

    console.log(
      JSON.stringify({
        event: "mcp_call",
        endpoint,
        method,
        tool: body.tool,
        status: upstream.status,
        durationMs: Date.now() - started,
      }),
    );

    if (!upstream.ok && !result) {
      return jsonResponse(
        { ok: false, error: "Upstream returned " + upstream.status },
        upstream.status,
      );
    }

    const envelope = (result || {}) as {
      result?: unknown;
      error?: unknown;
    };
    if (envelope.error) {
      return jsonResponse(
        { ok: false, error: JSON.stringify(envelope.error) },
        200,
      );
    }
    return jsonResponse({ ok: true, result: envelope.result ?? envelope });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "mcp_error",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return jsonResponse(
      { ok: false, error: "MCP relay failed: " + (error instanceof Error ? error.message : String(error)) },
      200,
    );
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

    const limited = checkRateLimit(request, env);
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

    const aiResponse: unknown = await env.AI.run(
      "@cf/bytedance/stable-diffusion-xl-lightning",
      { prompt, width, height },
    );

    // Normalize any Workers AI response shape into PNG bytes / base64.
    let imageBody: BodyInit | null = null;
    let base64: string | null = null;
    let byteLength: number | undefined;

    if (aiResponse instanceof ArrayBuffer) {
      imageBody = aiResponse;
      byteLength = aiResponse.byteLength;
    } else if (ArrayBuffer.isView(aiResponse)) {
      const view = aiResponse;
      const copy = new Uint8Array(view.byteLength);
      copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      imageBody = copy;
      byteLength = copy.byteLength;
    } else if (aiResponse instanceof ReadableStream) {
      const buf = await new Response(aiResponse).arrayBuffer();
      imageBody = buf;
      byteLength = buf.byteLength;
    } else if (typeof aiResponse === "string") {
      base64 = aiResponse.replace(/^data:image\/\w+;base64,/, "");
    } else if (aiResponse && typeof aiResponse === "object") {
      const obj = aiResponse as Record<string, unknown>;
      if (typeof obj.image === "string") {
        base64 = obj.image.replace(/^data:image\/\w+;base64,/, "");
      } else if (obj.image instanceof ArrayBuffer) {
        imageBody = obj.image;
        byteLength = obj.image.byteLength;
      } else if (ArrayBuffer.isView(obj.image)) {
        const view = obj.image;
        const copy = new Uint8Array(view.byteLength);
        copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
        imageBody = copy;
        byteLength = copy.byteLength;
      }
    }

    // Prefer JSON base64 so clients never lose the image to sanitizers / blob quirks.
    if (imageBody && !base64) {
      const bytes =
        typeof imageBody === "string"
          ? null
          : imageBody instanceof ArrayBuffer
            ? new Uint8Array(imageBody)
            : imageBody instanceof Uint8Array
              ? imageBody
              : new Uint8Array(await new Response(imageBody).arrayBuffer());
      if (bytes) {
        base64 = bytesToBase64(bytes);
        byteLength = bytes.byteLength;
      }
    }

    if (base64) {
      console.log(
        JSON.stringify({
          event: "image_complete",
          durationMs: Date.now() - started,
          encoding: "base64",
          bytes: byteLength,
        }),
      );
      return jsonResponse({ image_base64: base64, mime: "image/png" });
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

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Normalize Workers AI chat output into { response, tool_calls }.
 */
function normalizeChatResult(result: unknown): {
  response: string;
  tool_calls: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
} {
  if (typeof result === "string") {
    return { response: result, tool_calls: [] };
  }
  if (!result || typeof result !== "object") {
    return { response: "", tool_calls: [] };
  }

  // Unwrap common envelopes: { result }, { choices: [{ message }] }
  let r = result as Record<string, unknown>;
  if (r.result && typeof r.result === "object") {
    r = r.result as Record<string, unknown>;
  }
  if (Array.isArray(r.choices) && r.choices[0] && typeof r.choices[0] === "object") {
    const msg = (r.choices[0] as Record<string, unknown>).message;
    if (msg && typeof msg === "object") {
      r = msg as Record<string, unknown>;
    }
  }

  let response = "";
  if (typeof r.response === "string") response = r.response;
  else if (typeof r.text === "string") response = r.text;
  else if (typeof r.content === "string") response = r.content;
  else if (Array.isArray(r.content)) {
    response = (r.content as unknown[])
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in (part as object)) {
          return String((part as { text?: string }).text || "");
        }
        return "";
      })
      .join("");
  }

  const rawCalls =
    (Array.isArray(r.tool_calls) && r.tool_calls) ||
    (Array.isArray(r.toolCalls) && r.toolCalls) ||
    [];

  const tool_calls = rawCalls
    .map((c, i) => {
      if (!c || typeof c !== "object") return null;
      const call = c as Record<string, unknown>;
      const fn = (call.function || call) as Record<string, unknown>;
      const name = String(fn.name || call.name || "");
      if (!name) return null;
      let args: unknown = fn.arguments ?? call.arguments ?? {};
      if (typeof args !== "string") {
        try {
          args = JSON.stringify(args);
        } catch {
          args = "{}";
        }
      }
      return {
        id: String(call.id || "call_" + i),
        type: "function",
        function: { name, arguments: String(args) },
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;

  return { response, tool_calls };
}
