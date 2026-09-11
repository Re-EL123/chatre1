/**
 * Chatre — Cloudflare Workers AI chat + image generation + browser automation.
 *
 * @license MIT
 */
import { Env, ChatMessage, ChatRequestBody } from "./types";
import { handleBrowserRequest } from "./browser";

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

const AGENT_SYSTEM_PROMPT =
  "You are Chatre, a universal computer-use agent: you operate a real browser and a computer workspace the way a human would. Keep working until the user's request is fully solved.\n\n" +
  "## Non-negotiable rules\n" +
  "1. Iterate with tools until the work is complete and verified.\n" +
  "2. When you say you will do something, make the tool call in the same turn.\n" +
  "3. Never invent file or page contents — observe with tools first.\n" +
  "4. Prefer small, testable increments.\n" +
  "5. Before finishing, verify. If verification fails, fix and retry.\n" +
  "6. Maintain a live todo list. Check items off as you complete them.\n" +
  "7. Do not ask the user what to do next while todos remain open.\n" +
  "8. Casual chat may answer without tools. Any computer/browser/build task MUST use tools.\n\n" +
  "## Capabilities\n" +
  "- Browser: navigate, click, type, press keys, scroll, wait, screenshot, read page text/HTML, evaluate JS, follow links.\n" +
  "- Computer: shell (execute_command), files, directories, search, git, JS/Python, HTTP requests (http_request).\n" +
  "- Build: OpenCode explore → plan+todos → implement → verify → document → git.\n\n" +
  "## Browser workflow\n" +
  "1. browser_navigate to the URL.\n" +
  "2. Read returned text / links / inputs (and screenshot note).\n" +
  "3. browser_click / browser_type / browser_press using CSS selectors from the snapshot.\n" +
  "4. browser_screenshot or browser_read to confirm. Retry with different selectors if needed.\n" +
  "5. Use http_request for APIs when a full browser is unnecessary.\n\n" +
  "## Build workflow\n" +
  "Explore → plan + todo set → implement → verify → document → git (when asked) → finish only when gates pass.\n\n" +
  "## Tools\n" +
  "Prefer native function/tool calls. Fallback:\n" +
  '```tool\n{"tool":"TOOL_NAME","params":{...}}\n```\n' +
  "Tools include: browser_navigate, browser_click, browser_type, browser_press, browser_screenshot, browser_read, " +
  "browser_evaluate, browser_wait, browser_scroll, http_request, todo, plan, list_skills, use_skill, " +
  "execute_command, read_file, write_file, append_file, list_directory, create_directory, delete_file, " +
  "view_tree, find_files, search_code, run_javascript, run_python, create_document, verify_project, " +
  "git_init, git_add, git_commit, git_status, git_log, git_push.\n\n" +
  "Communication: one short sentence before a tool burst. Write files instead of pasting large code. Be direct.";


const SYSTEM_PROMPT = AGENT_SYSTEM_PROMPT;

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

    if (url.pathname === "/api/browser") {
      if (request.method === "OPTIONS") return optionsResponse();
      if (request.method === "POST") {
        if (!authorized(request, env)) {
          return jsonResponse({ error: "Unauthorized" }, 401);
        }
        const limited = checkRateLimit(request);
        if (limited) return limited;
        return handleBrowserRequest(request, env);
      }
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
    const agentMode = body.agent === true;
    const systemPrompt = agentMode ? AGENT_SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT;

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
    const tools = Array.isArray(body.tools) ? body.tools : null;
    const wantStream = body.stream !== false && !tools;
    const maxTokens = clampMaxTokens(
      body.max_tokens ?? (agentMode ? 3072 : DEFAULT_MAX_TOKENS),
    );

    console.log(
      JSON.stringify({
        event: "chat_request",
        model: modelId,
        stream: wantStream,
        agent: agentMode,
        tools: tools ? tools.length : 0,
        messageCount: messages.length,
        maxTokens,
        ip: clientIp(request),
      }),
    );

    if (!wantStream) {
      const runInput: Record<string, unknown> = {
        messages,
        max_tokens: maxTokens,
      };
      if (tools && tools.length) {
        runInput.tools = tools;
      }

      let result: unknown;
      try {
        result = await env.AI.run(modelId as keyof AiModels, runInput as never);
      } catch (toolErr) {
        // Some models reject tools — retry without them
        if (tools && tools.length) {
          console.warn(
            JSON.stringify({
              event: "chat_tools_fallback",
              error:
                toolErr instanceof Error ? toolErr.message : String(toolErr),
            }),
          );
          result = await env.AI.run(modelId as keyof AiModels, {
            messages,
            max_tokens: maxTokens,
          } as never);
        } else {
          throw toolErr;
        }
      }

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
