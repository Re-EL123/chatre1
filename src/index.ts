// src/index.ts
var CHAT_MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
var IMG_MODEL_TXT2IMG = "@cf/stabilityai/stable-diffusion-xl-base-1.0";
var SYSTEM_PROMPT = "You are a helpful, friendly assistant. You think like an African, the most intelligent. Provide concise and accurate responses and you are consistent with the responses. You provide suggestions to help users with the next prompts. Your name is Chatre";
var index_default = {
  /**
   * Main request handler for the Worker
   */
  async fetch(request, env2, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env2.ASSETS.fetch(request);
    }
    if (url.pathname === "/api/chat") {
      if (request.method === "POST") {
        return handleChatRequest(request, env2);
      }
      return new Response("Method not allowed", { status: 405 });
    }
    if (url.pathname === "/api/generate-image") {
      if (request.method === "POST") {
        return handleImageRequest(request, env2);
      }
      return new Response("Method not allowed", { status: 405 });
    }
    return new Response("Not found", { status: 404 });
  }
};
async function handleChatRequest(request, env2) {
  try {
    const { messages = [] } = await request.json();
    if (!messages.some((msg) => msg.role === "system")) {
      messages.unshift({ role: "system", content: SYSTEM_PROMPT });
    }
    const response = await env2.AI.run(
      CHAT_MODEL_ID,
      { messages, max_tokens: 1024 },
      { returnRawResponse: true }
    );
    return response;
  } catch (error3) {
    console.error("Error processing chat request:", error3);
    return new Response(
      JSON.stringify({ error: "Failed to process request" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}
__name(handleChatRequest, "handleChatRequest");
async function handleImageRequest(request, env2) {
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
    const model = IMG_MODEL_TXT2IMG;
    const payload = {
      prompt,
      negative_prompt,
      width,
      height,
      num_steps,
      strength,
      guidance,
      seed
    };
    console.log("Sending payload to Workers AI:", JSON.stringify(payload));
    const aiResponse = await env2.AI.run(model, payload);
    if (!(aiResponse instanceof ArrayBuffer)) {
      console.error("Unexpected AI response format:", aiResponse);
      return new Response(
        JSON.stringify({ error: "Invalid AI response format", details: aiResponse }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(aiResponse, {
      headers: { "Content-Type": "image/png" }
    });
  } catch (err) {
    console.error("Image generation failed:", err.message || err);
    return new Response(
      JSON.stringify({ error: "Image generation failed", details: err.message || String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
__name(handleImageRequest, "handleImageRequest");
export {
  index_default as default
};
/**
 * LLM Chat + Image Application
 *
 * A simple chat + image app using Cloudflare Workers AI.
 * Supports streaming chat responses (SSE) and txt2img image generation.
 *
 * @license MIT
 */
//# sourceMappingURL=index.js.map
