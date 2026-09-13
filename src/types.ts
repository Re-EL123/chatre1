/**
 * Type definitions for the LLM chat application.
 */

export interface Env {
  AI: Ai;
  ASSETS: Fetcher;
  /** Cloudflare Browser Rendering binding for Puppeteer. */
  BROWSER?: Fetcher;
  /** Per-thread browser session Durable Object namespace. */
  BROWSER_SESSIONS?: DurableObjectNamespace;
  /**
   * Optional shared secret. When set, API POSTs must send
   * Authorization: Bearer <secret> or x-chatre-key: <secret>.
   */
  CHATRE_SECRET?: string;
  /** Optional Brave Search API key for stronger search_web. */
  BRAVE_API_KEY?: string;
  /** Public Firebase web app config (safe to expose in the browser). */
  FIREBASE_API_KEY?: string;
  FIREBASE_WEB_API_KEY?: string;
  VITE_FIREBASE_API_KEY?: string;
  FIREBASE_AUTH_DOMAIN?: string;
  VITE_FIREBASE_AUTH_DOMAIN?: string;
  FIREBASE_PROJECT_ID?: string;
  VITE_FIREBASE_PROJECT_ID?: string;
  FIREBASE_APP_ID?: string;
  VITE_FIREBASE_APP_ID?: string;
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
  /** chat (default) | analyst (plan/brief only) | agent (executor). */
  mode?: "chat" | "analyst" | "agent" | "critic";
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
