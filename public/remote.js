/**
 * Chatre remote API client — Vercel + Firestore backend.
 */
(function () {
  "use strict";

  function apiBase() {
    return (
      window.CHATRE_API_BASE ||
      localStorage.getItem("chatre_api_base") ||
      ""
    ).replace(/\/$/, "");
  }

  function apiKey() {
    return (
      window.CHATRE_API_KEY ||
      localStorage.getItem("chatre_api_key") ||
      ""
    );
  }

  function enabled() {
    return !!apiBase();
  }

  function headers() {
    const h = { "Content-Type": "application/json", Accept: "application/json" };
    const key = apiKey();
    if (key) {
      h.Authorization = "Bearer " + key;
      h["x-chatre-key"] = key;
    }
    return h;
  }

  async function request(path, options) {
    const base = apiBase();
    if (!base) throw new Error("CHATRE_API_BASE not set");
    const res = await fetch(base + path, {
      ...options,
      headers: { ...headers(), ...(options && options.headers) },
    });
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("text/event-stream")) return res;
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      throw new Error((data && data.error) || "API " + res.status);
    }
    return data;
  }

  async function health() {
    return request("/api/health", { method: "GET" });
  }

  async function createThread(title, model) {
    return request("/api/threads", {
      method: "POST",
      body: JSON.stringify({ title, model }),
    });
  }

  async function listThreads() {
    return request("/api/threads", { method: "GET" });
  }

  async function getMessages(threadId) {
    return request(
      "/api/threads?id=" + encodeURIComponent(threadId) + "&action=messages",
      { method: "GET" },
    );
  }

  async function getWorkspace(id) {
    const q = id ? "?id=" + encodeURIComponent(id) : "";
    return request("/api/workspace" + q, { method: "GET" });
  }

  async function exec(cmd, workspaceId, cwd) {
    return request("/api/exec", {
      method: "POST",
      body: JSON.stringify({ cmd, workspaceId, cwd }),
    });
  }

  /**
   * Stream agent run via SSE.
   * onEvent(ev) for each JSON event; returns { threadId, workspaceId, response }.
   */
  async function runAgentStream({ message, threadId, workspaceId, model, onEvent, signal }) {
    const base = apiBase();
    if (!base) throw new Error("CHATRE_API_BASE not set");

    const res = await fetch(base + "/api/agent", {
      method: "POST",
      headers: headers(),
      signal,
      body: JSON.stringify({
        message,
        threadId,
        workspaceId,
        model,
        stream: true,
      }),
    });

    if (!res.ok) {
      let err = "Agent API failed";
      try {
        const j = await res.json();
        if (j && j.error) err = j.error;
      } catch {
        /* ignore */
      }
      throw new Error(err);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let carry = "";
    let meta = { threadId: threadId || null, workspaceId: workspaceId || null, response: "" };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += decoder.decode(value, { stream: true });
      const parts = carry.split("\n");
      carry = parts.pop() || "";
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const ev = JSON.parse(payload);
          if (ev.type === "start") {
            meta.threadId = ev.threadId || meta.threadId;
            meta.workspaceId = ev.workspaceId || meta.workspaceId;
          }
          if (ev.type === "done") meta.response = ev.response || meta.response;
          if (ev.type === "text" && ev.final) meta.response = ev.text;
          onEvent && onEvent(ev);
        } catch {
          /* ignore */
        }
      }
    }
    return meta;
  }

  window.ChatreRemote = {
    enabled,
    apiBase,
    apiKey,
    health,
    createThread,
    listThreads,
    getMessages,
    getWorkspace,
    exec,
    runAgentStream,
  };
})();
