# LLM Chat Application Template

A simple, ready-to-deploy chat application template powered by Cloudflare Workers AI. This template provides a clean starting point for building AI chat applications with streaming responses.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/templates/tree/main/llm-chat-app-template)

<!-- dash-content-start -->

## Demo

This template demonstrates how to build an AI-powered chat interface using Cloudflare Workers AI with streaming responses. It features:

- Real-time streaming of AI responses (Workers AI NDJSON / SSE-style chunks)
- Abort / Stop to cancel in-flight generation
- Markdown rendering with sanitized HTML and copyable code blocks
- Image generation via `/api/generate-image` (`/image …` or Image mode)
- Optional API secret, rate limiting, model picker, history trimming
- Clean, responsive UI that works on mobile and desktop

## Features

- Streaming chat with Stop
- Server-side history trim (last 20 non-system messages)
- Configurable `max_tokens` (default 2048, hard max 4096)
- Optional `CHATRE_SECRET` auth on chat + image APIs
- Best-effort rate limit (30 req/min per IP per isolate)
- Structured observability logs
- Markdown via marked + DOMPurify
- Optional **chatre-api** (Vercel + Firestore): persisted threads, sandbox exec, SSE agent
- Auth status badge (Connected / Unauthorized), thread sidebar, file explorer + ZIP export, usage meter
- Agent: streamed tokens per step, auto skill routing, tool-result summarization
<!-- dash-content-end -->

## Remote API (Firestore + sandbox)

The sibling repo lives at **`/home/akani/Documents/chatre-api`** ([github.com/Re-EL123/chatre-api](https://github.com/Re-EL123/chatre-api)). It stores threads/workspaces in Firestore (`re-el-eed0d`) and streams agent runs over SSE.

```bash
cd /home/akani/Documents/chatre-api
cp .env.example .env.local   # set FIREBASE_SERVICE_ACCOUNT, CHATRE_API_TOKEN, CHATRE_WORKER_URL
npm install
npm run check-env            # pre-deploy checklist
npm start                    # http://localhost:8080
```

In the Chatre UI paste your `CHATRE_API_TOKEN` into the toolbar — status shows **Connected** or **Unauthorized**. Or:

```js
localStorage.setItem("chatre_api_base", "http://localhost:8080");
localStorage.setItem("chatre_api_key", "YOUR_CHATRE_API_TOKEN");
location.reload();
```

Publish `firestore.rules` from chatre-api in Firebase Console (deny-all for `sites/chatre/**`, Admin SDK only).

Deploy API with `npx vercel` and point `CHATRE_WORKER_URL` at your Cloudflare Worker.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or newer)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- A Cloudflare account with Workers AI access

### Installation

1. Clone this repository and install dependencies:

   ```bash
   npm install
   ```

2. Generate Worker type definitions:
   ```bash
   npm run cf-typegen
   ```

### Development

```bash
npm run dev
```

Local server: http://localhost:8787

Note: Workers AI uses your Cloudflare account even during local development and may incur usage charges.

### Deployment

```bash
npm run deploy
```

### Monitor

```bash
npx wrangler tail
```

## Project Structure

```
/
├── public/             # Static assets
│   ├── index.html      # Chat UI shell + styles
│   └── chat.js         # Chat UI (stream, abort, markdown, images)
├── src/
│   ├── index.ts        # Worker entry (chat + image APIs)
│   └── types.ts        # TypeScript type definitions
├── wrangler.jsonc      # Cloudflare Worker configuration
├── tsconfig.json
└── README.md
```

## How It Works

### Backend

1. **`POST /api/chat`** — chat messages; streams by default (`stream: false` for JSON)
2. **`POST /api/generate-image`** — Stable Diffusion XL Lightning; returns PNG bytes (or JSON base64)
3. **`GET /api/models`** — allowed models and token limits
4. Auth (optional): `Authorization: Bearer <CHATRE_SECRET>` or `x-chatre-key`
5. Rate limit: 30 requests/minute per client IP (per isolate)

### Frontend

1. Streams tokens into the assistant bubble; **Stop** aborts the fetch
2. Renders Markdown (GFM) through marked, sanitized with DOMPurify
3. Images: Image mode toggle or `/image your prompt`
4. Optional key: `localStorage.chatre_key` or `window.CHATRE_KEY`

## Customization

### Changing the Model

Update `MODEL_ID` / `ALLOWED_MODELS` in `src/index.ts`, or use the UI model picker.

### Using AI Gateway

Uncomment / add gateway options in `env.AI.run` calls as described in the [AI Gateway docs](https://developers.cloudflare.com/ai-gateway/) for production caching and stricter rate limits.

### System Prompt

Edit `SYSTEM_PROMPT` in `src/index.ts`.

### Auth for embeds

Set Worker secret `CHATRE_SECRET`, then in the page:

```js
localStorage.setItem("chatre_key", "your-secret");
```

## Resources

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Cloudflare Workers AI Documentation](https://developers.cloudflare.com/workers-ai/)
- [Workers AI Models](https://developers.cloudflare.com/workers-ai/models/)
