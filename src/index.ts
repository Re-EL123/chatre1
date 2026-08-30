/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE) and image generation.
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const ALLOWED_MODELS = new Set([
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.1-8b-instruct",
  "@cf/meta/llama-3.1-8b-instruct-fp8-fast",
  "@cf/meta/llama-3.2-3b-instruct",
]);

const SYSTEM_PROMPT =
  "You are a helpful, friendly assistant. You think like an African, the most intelligent. Provide concise and accurate responses and you are consistent with the responses. You provide suggestions to help users with the next prompts. Your name is Chatre";

function authorized(request: Request, env: Env): boolean {
  const secret = env.CHATRE_SECRET;
  if (!secret) return true;
  const header = request.headers.get("authorization") || "";
  if (header === "Bearer " + secret) return true;
  if (request.headers.get("x-chatre-key") === secret) return true;
  return false;
}

export default {
  /**
   * Main request handler for the Worker
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Serve static assets (frontend)
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // Chat endpoint
    if (url.pathname === "/api/chat") {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, x-chatre-key",
          },
        });
      }
      if (request.method === "POST") {
        return handleChatRequest(request, env);
      }
      return new Response("Method not allowed", { status: 405 });
    }

    // Image generation endpoint
    if (url.pathname === "/api/generate-image") {
      if (request.method === "POST") {
        return handleImageRequest(request, env);
      }
      return new Response("Method not allowed", { status: 405 });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/**
 * Handles chat API requests
 */
async function handleChatRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    if (!authorized(request, env)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    const body = (await request.json()) as {
      messages?: ChatMessage[];
      stream?: boolean;
      model?: string;
    };
    const messages = Array.isArray(body.messages) ? body.messages : [];

    if (!messages.some((msg) => msg.role === "system")) {
      messages.unshift({ role: "system", content: SYSTEM_PROMPT });
    }

    const modelId = body.model && ALLOWED_MODELS.has(body.model) ? body.model : MODEL_ID;
    const wantStream = body.stream !== false;

    if (!wantStream) {
      const result = (await env.AI.run(modelId, {
        messages,
        max_tokens: 1024,
      })) as { response?: string } | string;
      const text = typeof result === "string" ? result : String((result && result.response) || "");
      return new Response(JSON.stringify({ response: text }), {
        headers: {
          "content-type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    const response = await env.AI.run(
      modelId,
      {
        messages,
        max_tokens: 1024,
      },
      {
        returnRawResponse: true,
      },
    );

    return response;
  } catch (error) {
    console.error("Error processing chat request:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process request" }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
}

/**
 * Handles image generation API requests
 */
async function handleImageRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const { prompt, width = 512, height = 512 } = await request.json();

    if (!prompt || prompt.trim() === "") {
      return new Response(
        JSON.stringify({ error: "Prompt cannot be empty" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const aiResponse = await env.AI.run(
      "@cf/bytedance/stable-diffusion-xl-lightning",
      { prompt, width, height },
    );

    // Convert AI response to base64
    let base64: string;

    if (aiResponse instanceof ArrayBuffer) {
      const uint8 = new Uint8Array(aiResponse);
      base64 = btoa(String.fromCharCode(...uint8));
    } else if (typeof aiResponse === "string") {
      base64 = aiResponse;
    } else if ("image" in aiResponse) {
      base64 = aiResponse.image;
    } else {
      return new Response(
        JSON.stringify({ error: "Invalid AI response" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ image_base64: base64 }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Image generation failed:", err);
    return new Response(
      JSON.stringify({ error: "Image generation failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
