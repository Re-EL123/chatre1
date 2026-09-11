# Chatre desktop companion (optional)

Localhost-only helper for OS actions the cloud browser cannot do (open a URL in your real desktop browser).

```bash
CHATRE_COMPANION_TOKEN=local-dev-only node desktop-companion/server.js
```

Then point a future `computer_desktop` tool at `http://127.0.0.1:7843` with header `X-Chatre-Companion: local-dev-only`.

Never expose this port publicly.
