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
async function handleImageRequest(request, env2) {
  try {
    const { prompt, width = 512, height = 512 } = await request.json();

    if (!prompt || prompt.trim() === "") {
      return new Response(
        JSON.stringify({ error: "Prompt cannot be empty" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Run the txt2img model
    const aiResponse = await env2.AI.run(
      "@cf/runwayml/stable-diffusion-v1-5-txt2img",
      {
        prompt,
        width,
        height,
        num_steps: 20,       // optional: higher = more detailed
        guidance: 7.5        // optional: higher = closer to prompt
      }
    );

    let base64Image;

    // Handle different response types
    if (aiResponse instanceof ArrayBuffer) {
      const uint8 = new Uint8Array(aiResponse);
      base64Image = btoa(String.fromCharCode(...uint8));
    } else if (typeof aiResponse === "string") {
      base64Image = aiResponse;
    } else if ("image" in aiResponse) {
      base64Image = aiResponse.image;
    } else {
      return new Response(
        JSON.stringify({ error: "Invalid AI response" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ image_base64: base64Image }),
      { headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Image generation failed:", err);
    return new Response(
      JSON.stringify({ error: "Image generation failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

