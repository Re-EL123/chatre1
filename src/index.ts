/**
 * LLM Chat + Image Application
 *
 * A simple chat + image app using Cloudflare Workers AI.
 * Supports streaming chat responses (SSE) and txt2img image generation.
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

// Model IDs
const CHAT_MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const IMG_MODEL_TXT2IMG = "@cf/runwayml/stable-diffusion-v1-5-txt2img";
const IMG_MODEL_IMG2IMG = "@cf/runwayml/stable-diffusion-v1-5-img2img";

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
async function handleChatRequest(request: Request, env: Env) {
  try {
    const { messages = [] } = await request.json();

    // Ensure system prompt is present
    if (!messages.some((msg) => msg.role === "system")) {
      messages.unshift({ role: "system", content: SYSTEM_PROMPT });
    }

    const response = await env.AI.run(
      CHAT_MODEL_ID,
      { messages, max_tokens: 1024 },
      { returnRawResponse: true }
    );

    return response;

  } catch (error) {
    console.error("Error processing chat request:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process request" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}


/**
 * Handles image API requests (txt2img / img2img)
 */
async function handleImageRequest(request: Request, env: Env) {
  try {
    const {
      prompt,
      negative_prompt,
      height = 512,
      width = 512,
      image,
      image_b64,
      mask,
      num_steps = 20,
      strength = 1,
      guidance = 7.5,
      seed,
      type = "txt2img"
    } = await request.json();

    if (!prompt || prompt.trim() === "") {
      return new Response(
        JSON.stringify({ error: "Prompt cannot be empty" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Choose model
    const model = type === "img2img" ? IMG_MODEL_IMG2IMG : IMG_MODEL_TXT2IMG;

    // Build payload for model
    const payload: Record<string, any> = {
      prompt,
      negative_prompt,
      width,
      height,
      num_steps,
      strength,
      guidance,
      seed
    };

    if (image) payload.image = image;
    if (image_b64) payload.image_b64 = image_b64;
    if (mask) payload.mask = mask;

    // Run AI
    const aiResponse: any = await env.AI.run(model, payload);

    if (!aiResponse || !aiResponse.images || aiResponse.images.length === 0) {
      return new Response(
        JSON.stringify({ error: "No image returned from model" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Convert base64 to Uint8Array
    const imageBase64 = aiResponse.images[0];
    const imageBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));

    return new Response(imageBuffer, {
      headers: { "Content-Type": "image/png" }
    });

  } catch (err) {
    console.error("Image generation failed:", err);
    return new Response(
      JSON.stringify({ error: "Image generation failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
