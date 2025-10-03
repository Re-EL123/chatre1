/**
 * Type definitions for the LLM chat application.
 */

/**
 * Environment bindings for Cloudflare Worker.
 */
export interface Env {
  /**
   * Binding for the Workers AI API.
   */
  AI: Ai;
  /**
   * Binding for static assets.
   */
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

/**
 * Represents a chat message.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Represents a request for image generation.
 */
export interface ImageRequest {
  prompt: string;
  width?: number;
  height?: number;
}

/**
 * Represents the response from the image generation endpoint.
 */
export interface ImageResponse {
  image_base64: string;
}
