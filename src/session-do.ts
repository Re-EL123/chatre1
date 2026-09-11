/**
 * Durable Object: per-thread browser session + cookie profile.
 */
export class BrowserSessionDO {
  state: DurableObjectState;
  env: EnvLike;
  data: SessionData;

  constructor(state: DurableObjectState, env: EnvLike) {
    this.state = state;
    this.env = env;
    this.data = emptySession();
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<SessionData>("session");
      if (stored) this.data = { ...emptySession(), ...stored };
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
      if (Array.isArray(body.cookies)) {
        this.data.cookies = body.cookies.slice(0, 400);
      }
      if (body.profileKey != null) {
        this.data.profileKey = String(body.profileKey).slice(0, 120);
      }
      if (body.loginPaused != null) {
        this.data.loginPaused = !!body.loginPaused;
      }
      this.data.updatedAt = Date.now();
      await this.state.storage.put("session", this.data);
      // Keep DO alive for long profiles (alarm refresh every 12h)
      try {
        await this.state.storage.setAlarm(Date.now() + 12 * 60 * 60 * 1000);
      } catch {
        /* ignore */
      }
      return json({ ok: true, ...this.data });
    }
    if (request.method === "POST" && url.pathname.endsWith("/clear")) {
      this.data = emptySession();
      this.data.updatedAt = Date.now();
      await this.state.storage.put("session", this.data);
      return json({ ok: true });
    }
    return json({ ok: false, error: "Not found" }, 404);
  }

  async alarm(): Promise<void> {
    // Persist cookie profile indefinitely; browser rendering session may expire.
    this.data.updatedAt = Date.now();
    await this.state.storage.put("session", this.data);
    try {
      await this.state.storage.setAlarm(Date.now() + 12 * 60 * 60 * 1000);
    } catch {
      /* ignore */
    }
  }
}

function emptySession(): SessionData {
  return {
    sessionId: "",
    lastTabId: null,
    cookies: [],
    profileKey: "",
    loginPaused: false,
    updatedAt: 0,
  };
}

export interface SessionData {
  sessionId: string;
  lastTabId: number | null;
  cookies: Array<Record<string, unknown>>;
  profileKey: string;
  loginPaused: boolean;
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
