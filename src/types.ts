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
  /**
   * Optional shared secret. When set, POST /api/chat must send
   * Authorization: Bearer <secret> or x-chatre-key: <secret>.
   * Leave unset for the public Chatre UI; set it for Brandon Holdings.
   */
  CHATRE_SECRET?: string;
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
