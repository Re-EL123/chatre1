# Chatre desktop companion

Controls the **real OS** (open URLs, screenshot, clipboard, notifications). The cloud browser cannot do this.

## Quick start (local tools)

```bash
npm run companion
# listens on http://127.0.0.1:7843
```

Local agent `desktop_*` tools call this automatically.

## Bridge mode (cloud / remote agent)

So Vercel can reach your machine, the companion **polls** the API:

```bash
CHATRE_API_BASE=https://chatre-api.vercel.app \
CHATRE_API_TOKEN=your-token \
CHATRE_COMPANION_TOKEN=local-dev-only \
npm run companion
```

Keep this process running while you use remote agent desktop tools.

## Endpoints (localhost only)

| Method | Path | Body |
|--------|------|------|
| GET | `/health` | — |
| POST | `/open` | `{ "url": "https://…" }` |
| POST | `/screenshot` | — |
| POST | `/clipboard/get` | — |
| POST | `/clipboard/set` | `{ "text": "…" }` |
| POST | `/notify` | `{ "title", "body" }` |

Header: `X-Chatre-Companion: local-dev-only` (or your `CHATRE_COMPANION_TOKEN`).

Never expose port 7843 publicly.
