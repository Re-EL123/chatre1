/**
 * Durable Object: per-thread browser session registry.
 * Stores Cloudflare Browser Rendering session_id + last tab so agent loops
 * can reconnect reliably across Worker isolates.
 */
export class BrowserSessionDO {
  state: DurableObjectState;
  env: EnvLike;
  data: SessionData;

  constructor(state: DurableObjectState, env: EnvLike) {
    this.state = state;
    this.env = env;
    this.data = {
      sessionId: "",
      lastTabId: null as number | null,
      updatedAt: 0,
    };
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<SessionData>("session");
      if (stored) this.data = stored;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.endsWith("/get")) {
      return json(this.data);
    }
    if (request.method === "POST" && url.pathname.endsWith("/set")) {
      let body: Partial<SessionData> = {};
      try {
        body = (await request.json()) as Partial<SessionData>;
      } catch {
        return json({ ok: false, error: "Invalid JSON" }, 400);
      }
      if (body.sessionId != null) this.data.sessionId = String(body.sessionId);
      if (body.lastTabId !== undefined) {
        this.data.lastTabId =
          body.lastTabId == null ? null : Number(body.lastTabId);
      }
      this.data.updatedAt = Date.now();
      await this.state.storage.put("session", this.data);
      return json({ ok: true, ...this.data });
    }
    if (request.method === "POST" && url.pathname.endsWith("/clear")) {
      this.data = { sessionId: "", lastTabId: null, updatedAt: Date.now() };
      await this.state.storage.put("session", this.data);
      return json({ ok: true });
    }
    return json({ ok: false, error: "Not found" }, 404);
  }
}

interface SessionData {
  sessionId: string;
  lastTabId: number | null;
  updatedAt: number;
}

interface EnvLike {
  BROWSER_SESSIONS?: DurableObjectNamespace;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
