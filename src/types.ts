/**
 * Type definitions for the LLM chat application.
 */

export interface Env {
  AI: Ai;
  ASSETS: Fetcher;
  /** Cloudflare Browser Rendering binding for Puppeteer. */
  BROWSER?: Fetcher;
  /**
   * Optional shared secret. When set, API POSTs must send
   * Authorization: Bearer <secret> or x-chatre-key: <secret>.
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
  /** Use the thorough agent system prompt and ignore client system messages. */
  agent?: boolean;
  /** OpenAI-style tool definitions for structured function calling. */
  tools?: unknown[];
}

export interface ImageRequest {
  prompt: string;
  width?: number;
  height?: number;
}

export interface ImageResponse {
  image_base64: string;
}
