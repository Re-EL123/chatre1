/**
 * LLM Chat + Image Application
 *
 * A simple chat + image app using Cloudflare Workers AI.
 * Supports streaming chat responses (SSE) and both txt2img + img2img image generation.
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

// Model IDs
const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const IMG_MODEL_ID = "@cf/runwayml/stable-diffusion-v1-5-img2img";

// Default system prompt
const SYSTEM_PROMPT =
  "You are a helpful, friendly assistant. You think like an African, the most intelligent. Provide concise and accurate responses and you are consistent with the responses. You provide suggestions to help users with the next prompts. Your name is Chatre";

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
    const { messages = [] } = (await request.json()) as {
      messages: ChatMessage[];
    };

    // Add system prompt if missing
    if (!messages.some((msg) => msg.role === "system")) {
      messages.unshift({ role: "system", content: SYSTEM_PROMPT });
    }

    const response = await env.AI.run(
      MODEL_ID,
      {
        messages,
        max_tokens: 1024,
      },
      {
        returnRawResponse: true, // streaming
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
 * Supports both txt2img (if no image_b64) and img2img (if image_b64 provided)
 */
async function handleImageRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const {
      prompt,
      width = 512,
      height = 512,
      image_b64,
      negative_prompt,
      num_steps = 20,
      strength = 0.8,
      guidance = 7.5,
      seed,
    } = await request.json();

    if (!prompt || prompt.trim() === "") {
      return new Response(
        JSON.stringify({ error: "Prompt cannot be empty" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Build payload
    const payload: Record<string, unknown> = {
      prompt,
      width,
      height,
      negative_prompt,
      num_steps,
      guidance,
      seed,
    };

    // If image_b64 provided → img2img
    if (image_b64) {
      payload.image_b64 = image_b64;
      payload.strength = strength;
    }

    const aiResponse = await env.AI.run(IMG_MODEL_ID, payload);

    // Normalize AI response → base64 string
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
