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

  function syncKeyFromUi() {
    const fromInput = document.getElementById("api-key-input");
    if (!fromInput) return;
    const v = fromInput.value.trim();
    if (v) {
      localStorage.setItem("chatre_api_key", v);
      window.CHATRE_API_KEY = v;
    }
  }

  function apiKey() {
    syncKeyFromUi();
    const fromInput = document.getElementById("api-key-input");
    const typed = fromInput && fromInput.value ? fromInput.value.trim() : "";
    return (
      typed ||
      window.CHATRE_API_KEY ||
      localStorage.getItem("chatre_api_key") ||
      ""
    ).trim();
  }

  function enabled() {
    return !!apiBase();
  }

  function headers() {
    const h = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
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
   */
  async function runAgentStream({
    message,
    threadId,
    workspaceId,
    model,
    onEvent,
    signal,
  }) {
    const base = apiBase();
    if (!base) throw new Error("CHATRE_API_BASE not set");

    syncKeyFromUi();
    if (!apiKey()) {
      throw new Error(
        "API key is empty — paste your Vercel CHATRE_API_TOKEN into the API key field.",
      );
    }

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
      if (res.status === 401) {
        err +=
          " — the key must exactly match Vercel env CHATRE_API_TOKEN on chatre-api (redeploy after setting it).";
      }
      throw new Error(err);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let carry = "";
    let meta = {
      threadId: threadId || null,
      workspaceId: workspaceId || null,
      response: "",
    };

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
    syncKeyFromUi,
    health,
    createThread,
    listThreads,
    getMessages,
    getWorkspace,
    exec,
    runAgentStream,
  };
})();
