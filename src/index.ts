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
      strength = 0.75,
      guidance = 7.5,
      num_steps = 20,
      seed,
      negative_prompt
    } = await request.json();

    if (!prompt || prompt.trim() === "") {
      return new Response(
        JSON.stringify({ error: "Prompt cannot be empty" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Build model input
    const modelInput: Record<string, any> = { prompt, width, height, num_steps, guidance };
    if (image_b64) modelInput.image_b64 = image_b64; // img2img
    if (strength) modelInput.strength = strength;
    if (negative_prompt) modelInput.negative_prompt = negative_prompt;
    if (seed !== undefined) modelInput.seed = seed;

    // Call the model
    const aiResponse = await env.AI.run(IMG_MODEL_ID, modelInput);

    // Convert ArrayBuffer (binary PNG) to base64
    let base64: string;
    if (aiResponse instanceof ArrayBuffer) {
      const uint8 = new Uint8Array(aiResponse);
      base64 = btoa(String.fromCharCode(...uint8));
    } else {
      return new Response(
        JSON.stringify({ error: "Unexpected AI response format", details: aiResponse }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ image_base64: base64 }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Image generation failed:", err);
    return new Response(
      JSON.stringify({ error: "Image generation failed", details: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}


