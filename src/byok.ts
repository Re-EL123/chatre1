/**
 * BYOK (Bring Your Own Key) proxy — routes /api/chat to external providers
 * (OpenRouter, Groq, xAI, Gemini, Anthropic, OpenAI, DeepSeek, Mistral, …)
 * directly from the Worker, so the app works even when the free Workers AI
 * daily quota is exhausted. The client sends the provider key via the
 * `x-chatre-byok-key` header; the model id carries the provider prefix
 * (e.g. `openrouter:anthropic/claude-3.5-sonnet`).
 *
 * @license MIT
 */
import { ChatMessage } from "./types";

const OPENAI_COMPAT_PROVIDERS = new Set([
  "openrouter",
  "groq",
  "xai",
  "openai",
  "deepseek",
  "mistral",
  "aihubmix",
  "zai",
  "modelscope",
  "ollama",
  "dashscope",
  "huggingface",
]);

const PROVIDER_BASE_URL: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  xai: "https://api.x.ai/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
  aihubmix: "https://aihubmix.com/v1/chat/completions",
  zai: "https://api.z.ai/api/paas/v4/chat/completions",
  modelscope:
    "https://api-inference.modelscope.cn/v1/chat/completions",
  ollama: "http://localhost:11434/v1/chat/completions",
  dashscope:
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  huggingface:
    "https://router.huggingface.co/hf-inference/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
  google: "https://generativelanguage.googleapis.com/v1beta",
};

/** All BYOK ids the client knows about (the canonical list). */
const KNOWN_BYOK_IDS = [
  "openrouter", "aihubmix", "zai", "groq", "deepseek", "modelscope",
  "ollama", "kilo", "cloudflare", "llm7", "ovhcloud", "huggingface",
  "dashscope", "mistral", "xai", "anthropic", "openai", "google", "cursor",
];

/** Extract the provider prefix from a model id like `openrouter:model`. */
export function byokProviderOf(model: string): string | null {
  const m = /^([a-z0-9_-]+):/i.exec(String(model || "").trim());
  if (!m) return null;
  const p = m[1].toLowerCase();
  return KNOWN_BYOK_IDS.includes(p) ? p : null;
}

export function isByokProvider(provider: string): boolean {
  return KNOWN_BYOK_IDS.includes(provider);
}

function providerModels(provider: string, key: string): string {
  if (provider === "anthropic")
    return key.startsWith("sk-ant-") ? key : "sk-ant-" + key;
  return key;
}

/** API keys presented on the request, checked before first upstream call. */
function requireKey(key: string | null | undefined): boolean {
  return typeof key === "string" && key.trim().length > 8;
}

function openaiCompatibleBody(
  provider: string,
  model: string,
  messages: ChatMessage[],
  stream: boolean,
  maxTokens: number,
): Record<string, unknown> {
  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  // Strip any Worker-injected Chatre system prompt so the external model
  // sees a clean, provider-neutral instruction set.
  const systemText = system
    .map((m) => m.content)
    .join("\n\n")
    .replace(/You are Chatre[^\n]*\n/, "")
    .trim();
  const body: Record<string, unknown> = {
    model,
    messages: rest.map((m) => ({
      role: m.role === "system" ? "system" : m.role,
      content: m.content,
    })),
    stream,
    max_tokens: maxTokens,
  };
  if (systemText) {
    body.messages = [
      { role: "system", content: systemText },
      ...(body.messages as unknown[]),
    ];
  }
  if (provider === "openrouter") {
    (body as Record<string, unknown>).extra_body = {};
    if (!body.includes_headers) body.http_referer = "https://chatre.dev/";
    body.app_name = "chatre";
  }
  return body;
}

/** Parse model portion after the provider prefix. */
function bareModel(modelId: string): string {
  const idx = String(modelId || "").indexOf(":");
  return idx >= 0 ? String(modelId).slice(idx + 1) : String(modelId);
}

/**
 * Normalize an upstream OpenAI-compatible SSE stream into Chatre's stream
 * framing (`data: {"response":"…"}` lines) so the existing client parsers
 * keep working unchanged.
 */
async function passthroughOpenAiStream(
  upstream: Response,
): Promise<Response> {
  const body = upstream.body;
  const reader = body?.getReader();
  if (!body || !reader) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    });
  }
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      const lines = text.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]" || trimmed === "[DONE]") {
          continue;
        }
        const jsonStr = trimmed.startsWith("data:")
          ? trimmed.slice(5).trim()
          : trimmed;
        if (!jsonStr || jsonStr === "[DONE]") continue;
        try {
          const json = JSON.parse(jsonStr) as {
            choices?: Array<
              | { delta?: { content?: string }; text?: string; message?: { content?: string } }
              | { text?: string }
            >;
            error?: { message?: string };
          };
          if (json.error && json.error.message) {
            controller.enqueue(
              encoder.encode('data: {"error":"' + esc(json.error.message) + '"}\n\n'),
            );
            continue;
          }
          const c0 = (json.choices && json.choices[0]) as
            | { delta?: { content?: string }; text?: string; message?: { content?: string } }
            | undefined;
          let delta = "";
          if (c0 && typeof c0 === "object") {
            if (typeof c0.text === "string") delta = c0.text;
            else if (c0.delta && typeof c0.delta.content === "string")
              delta = c0.delta.content;
            else if (c0.message && typeof c0.message.content === "string")
              delta = c0.message.content;
          }
          if (delta) {
            const lines_ = delta.split("\n");
            for (const dl of lines_) {
              controller.enqueue(
                encoder.encode('data: {"response":"' + esc(dl) + '"}\n\n'),
              );
            }
          }
        } catch {
          // ignore non-JSON frames (keepalives, etc.)
        }
      }
    },
  });
  const injected = body.pipeThrough(transform);
  return new Response(injected, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function headersJson(): Record<string, string> {
  return { "content-type": "application/json" };
}

/**
 * Run a proxied completion against an external provider. Returns a Response
 * already framed for the client (SSE for stream, JSON `{response}` otherwise).
 */
export async function handleByokChat(opts: {
  provider: string;
  apiKey: string;
  modelId: string;
  messages: ChatMessage[];
  stream: boolean;
  maxTokens: number;
}): Promise<Response> {
  const { provider, apiKey, modelId, messages, stream, maxTokens } = opts;
  const model = bareModel(modelId);
  const base = PROVIDER_BASE_URL[provider];
  if (!base) {
    return new Response(
      JSON.stringify({ error: "Unknown BYOK provider: " + provider }),
      { status: 400, headers: headersJson() },
    );
  }

  // ── Anthropic (Messages API) ───────────────────────────────────────
  if (provider === "anthropic") {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const body = {
      model,
      messages: messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content })),
      max_tokens: maxTokens,
      stream,
    };
    const upstream = await fetch(base, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(system ? { ...body, system } : body),
    });
    if (!upstream.ok) {
      return relayError(upstream, provider);
    }
    if (stream) return anthropicStream(upstream);
    const json = (await upstream.json()) as { content?: Array<{ text?: string }>; };
    const text = Array.isArray(json.content)
      ? json.content.map((p) => p.text || "").join("")
      : "";
    return new Response(JSON.stringify({ response: text }), {
      status: 200,
      headers: headersJson(),
    });
  }

  // ── Google / Gemini (generateContent) ─────────────────────────────
  if (provider === "google") {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    const body: Record<string, unknown> = {
      contents,
      generationConfig: { maxOutputTokens: maxTokens },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const url =
      base + "/models/" + encodeURIComponent(model) + ":streamGenerateContent";
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!upstream.ok) return relayError(upstream, provider);
    if (stream) return geminiStream(upstream);
    const json = (await upstream.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text =
      (json.candidates &&
        json.candidates[0] &&
        json.candidates[0].content &&
        json.candidates[0].content.parts &&
        json.candidates[0].content.parts.map((p) => p.text || "").join("")) ||
      "";
    return new Response(JSON.stringify({ response: text }), {
      status: 200,
      headers: headersJson(),
    });
  }

  // ── OpenAI-compatible providers ────────────────────────────────────
  const body = openaiCompatibleBody(provider, model, messages, stream, maxTokens);
  const upstream = await fetch(base, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + apiKey,
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  if (!upstream.ok) return relayError(upstream, provider);

  if (stream) return passthroughOpenAiStream(upstream);

  const json = (await upstream.json()) as {
    choices?: Array<{ message?: { content?: string; tool_calls?: unknown } }>;
  };
  const content = json.choices?.[0]?.message?.content || "";
  return new Response(JSON.stringify({ response: content }), {
    status: 200,
    headers: headersJson(),
  });
}

async function relayError(upstream: Response, provider: string): Promise<Response> {
  const raw = await upstream.text().catch(() => "");
  let message = raw;
  try {
    const j = JSON.parse(raw) as {
      message?: string;
      error?: { message?: string };
    };
    message = j.error?.message || j.message || raw;
  } catch {
    /* keep raw */
  }
  return new Response(
    JSON.stringify({
      error:
        provider + " returned " + upstream.status + ": " + message.slice(0, 400),
    }),
    { status: upstream.status, headers: headersJson() },
  );
}

function anthropicStream(upstream: Response): Response {
  const body = upstream.body;
  const reader = body?.getReader();
  if (!body || !reader)
    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    });
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      const lines = text.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;
        try {
          const json = JSON.parse(jsonStr) as {
            type?: string;
            error?: { message?: string };
            delta?: { text?: string };
          };
          if (json.error && json.error.message) {
            controller.enqueue(
              encoder.encode('data: {"error":"' + esc(json.error.message) + '"}\n\n'),
            );
            continue;
          }
          if (json.type === "content_block_delta" && json.delta?.text) {
            controller.enqueue(
              encoder.encode(
                'data: {"response":"' + esc(json.delta.text) + '"}\n\n',
              ),
            );
          }
        } catch {
          /* ignore */
        }
      }
    },
  });
  return new Response(body.pipeThrough(transform), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function geminiStream(upstream: Response): Response {
  const body = upstream.body;
  const reader = body?.getReader();
  if (!body || !reader)
    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    });
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      const parts = text.split("\n");
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed.startsWith("data:")) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;
        try {
          const json = JSON.parse(jsonStr) as {
            candidates?: Array<{
              content?: { parts?: Array<{ text?: string }> };
            }>;
            error?: { message?: string };
          };
          if (json.error?.message) {
            controller.enqueue(
              encoder.encode('data: {"error":"' + esc(json.error.message) + '"}\n\n'),
            );
            continue;
          }
          const pieces =
            (json.candidates?.[0]?.content?.parts?.map((p) => p.text) || []);
          const delta = pieces.filter(Boolean).join("");
          if (delta) {
            controller.enqueue(
              encoder.encode('data: {"response":"' + esc(delta) + '"}\n\n'),
            );
          }
        } catch {
          /* ignore */
        }
      }
    },
  });
  return new Response(body.pipeThrough(transform), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

// Re-export for the main entry point.
export const byokHelpers = {
  requireKey,
  providerModels,
};