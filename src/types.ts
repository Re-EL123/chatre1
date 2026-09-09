/**
 * Type definitions for the LLM chat application.
 */

/**
 * Environment bindings for Cloudflare Worker.
 */
export interface Env {
  /** Workers AI binding */
  AI: Ai;
  /** Static assets (public/) */
  ASSETS: Fetcher;
  /**
   * Optional shared secret. When set, API POSTs must send
   * Authorization: Bearer <secret> or x-chatre-key: <secret>.
   * Leave unset for the public Chatre UI.
   */
  CHATRE_SECRET?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequestBody {
  messages?: ChatMessage[];
  stream?: boolean;
  model?: string;
  max_tokens?: number;
}

export interface ImageRequest {
  prompt: string;
  width?: number;
  height?: number;
}

export interface ImageResponse {
  image_base64: string;
}
