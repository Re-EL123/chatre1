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

  function hasAuth() {
    if (window.ChatreAuth && window.ChatreAuth.isSignedIn()) return true;
    return !!apiKey();
  }

  async function authHeaders() {
    const h = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    // Signed-in users must use Firebase ID token only — never fall back to
    // the site service key (that yields "Service token cannot list threads").
    if (window.ChatreAuth && window.ChatreAuth.isSignedIn()) {
      let token = null;
      try {
        token = await window.ChatreAuth.getIdToken(false);
        if (!token) token = await window.ChatreAuth.getIdToken(true);
      } catch (e) {
        console.warn("getIdToken failed", e);
      }
      if (token) {
        h.Authorization = "Bearer " + token;
        return h;
      }
      throw new Error(
        "Signed in, but Firebase could not issue an ID token. Refresh the page or sign out and back in.",
      );
    }
    syncKeyFromUi();
    const key = apiKey();
    if (key) {
      h.Authorization = "Bearer " + key;
      h["x-chatre-key"] = key;
    }
    return h;
  }

  function headers() {
    // Sync fallback for non-async callers; prefer authHeaders()
    const h = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (
      window.ChatreAuth &&
      window.ChatreAuth.state &&
      window.ChatreAuth.state.idToken
    ) {
      h.Authorization = "Bearer " + window.ChatreAuth.state.idToken;
      return h;
    }
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
    const h = await authHeaders();
    const res = await fetch(base + path, {
      ...options,
      headers: { ...h, ...(options && options.headers) },
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

  /** Authenticated ping for Connected / Unauthorized status */
  async function pingAuth() {
    const base = apiBase();
    if (!base) {
      return { ok: false, connected: false, status: "no-base", error: "No API base" };
    }
    try {
      if (window.ChatreAuth && window.ChatreAuth.isSignedIn()) {
        await window.ChatreAuth.getIdToken(false);
      } else {
        syncKeyFromUi();
      }
      const res = await fetch(base + "/api/health?auth=1", {
        method: "GET",
        headers: await authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          connected: false,
          status: "unauthorized",
          error: data.error || "Unauthorized",
          ...data,
        };
      }
      return { ok: true, connected: true, status: "connected", ...data };
    } catch (e) {
      return {
        ok: false,
        connected: false,
        status: "error",
        error: e.message || String(e),
      };
    }
  }

  async function getMe() {
    return request("/api/me", { method: "GET" });
  }

  async function patchMe(body) {
    return request("/api/me", {
      method: "PATCH",
      body: JSON.stringify(body || {}),
    });
  }

  async function saveByok(provider, apiKeyValue) {
    return request("/api/me?action=byok", {
      method: "PUT",
      body: JSON.stringify({ provider: provider, apiKey: apiKeyValue }),
    });
  }

  async function deleteByok(provider) {
    return request(
      "/api/me?action=byok&provider=" + encodeURIComponent(provider),
      { method: "DELETE" },
    );
  }

  async function testByok(provider) {
    return request("/api/me?action=byok&op=test", {
      method: "POST",
      body: JSON.stringify({ provider: provider }),
    });
  }

  async function memoryGet(key) {
    const q = key
      ? "/api/me?action=memory&key=" + encodeURIComponent(key)
      : "/api/me?action=memory";
    return request(q, { method: "GET" });
  }

  async function memorySet(key, value) {
    return request("/api/me?action=memory", {
      method: "PUT",
      body: JSON.stringify({ key: key, value: value }),
    });
  }

  async function memoryDelete(key) {
    return request(
      "/api/me?action=memory&key=" + encodeURIComponent(key),
      { method: "DELETE" },
    );
  }

  async function scheduleCreate(body) {
    return request("/api/me?action=schedules", {
      method: "POST",
      body: JSON.stringify(body || {}),
    });
  }

  async function scheduleList() {
    return request("/api/me?action=schedules", { method: "GET" });
  }

  async function scheduleCancel(id) {
    return request(
      "/api/me?action=schedules&id=" + encodeURIComponent(id),
      { method: "DELETE" },
    );
  }

  async function scheduleDue() {
    return request("/api/me?action=schedules&op=due", { method: "GET" });
  }

  async function listModels() {
    return request("/api/models", { method: "GET" });
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

  async function getThread(threadId) {
    return request("/api/threads?id=" + encodeURIComponent(threadId), {
      method: "GET",
    });
  }

  async function updateThread(threadId, patch) {
    return request("/api/threads?id=" + encodeURIComponent(threadId), {
      method: "PATCH",
      body: JSON.stringify(patch || {}),
    });
  }

  async function deleteThread(threadId) {
    return request("/api/threads?id=" + encodeURIComponent(threadId), {
      method: "DELETE",
    });
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

  async function exportWorkspace(id) {
    const q =
      "?action=export" + (id ? "&id=" + encodeURIComponent(id) : "");
    return request("/api/workspace" + q, { method: "GET" });
  }

  async function getFile(workspaceId, filePath) {
    return request(
      "/api/workspace?id=" +
        encodeURIComponent(workspaceId) +
        "&path=" +
        encodeURIComponent(filePath),
      { method: "GET" },
    );
  }

  async function putFile(workspaceId, filePath, content, type) {
    return request(
      "/api/workspace?action=file&id=" + encodeURIComponent(workspaceId),
      {
        method: "POST",
        body: JSON.stringify({
          path: filePath,
          content: content,
          type: type || "file",
        }),
      },
    );
  }

  async function getDiff(workspaceId, filePath) {
    return request(
      "/api/workspace?action=diff&id=" +
        encodeURIComponent(workspaceId) +
        "&path=" +
        encodeURIComponent(filePath),
      { method: "GET" },
    );
  }

  async function exec(cmd, workspaceId, cwd, opts) {
    const o = opts || {};
    return request("/api/exec", {
      method: "POST",
      body: JSON.stringify({
        cmd: cmd,
        workspaceId: workspaceId,
        cwd: cwd,
        mode: o.mode || "workspace",
        stream: false,
        timeoutMs: o.timeoutMs,
      }),
    });
  }

  async function execStream({
    cmd,
    workspaceId,
    cwd,
    mode,
    onEvent,
    signal,
    timeoutMs,
  }) {
    const base = apiBase();
    if (!base) throw new Error("CHATRE_API_BASE not set");
    const h = await authHeaders();
    const res = await fetch(base + "/api/exec", {
      method: "POST",
      headers: h,
      signal: signal,
      body: JSON.stringify({
        cmd: cmd,
        workspaceId: workspaceId,
        cwd: cwd,
        mode: mode || "workspace",
        stream: true,
        timeoutMs: timeoutMs,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(function () {
        return {};
      });
      throw new Error((data && data.error) || "exec " + res.status);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";
      for (let i = 0; i < parts.length; i++) {
        const line = parts[i].trim();
        if (!line.startsWith("data:")) continue;
        try {
          const ev = JSON.parse(line.slice(5).trim());
          if (onEvent) onEvent(ev);
        } catch {
          /* ignore */
        }
      }
    }
  }

  async function runAgentStream({
    message,
    threadId,
    workspaceId,
    model,
    onEvent,
    signal,
    resume,
    approvePlan,
    briefing,
    skipPlanApproval,
  }) {
    const base = apiBase();
    if (!base) throw new Error("CHATRE_API_BASE not set");

    syncKeyFromUi();
    if (!hasAuth()) {
      throw new Error(
        "Sign in to your Chatre account (Settings), or paste a service API token for advanced use.",
      );
    }

    const body = {
      threadId,
      workspaceId,
      model,
      stream: true,
    };
    if (resume || approvePlan) {
      body.resume = true;
      if (approvePlan) body.approvePlan = true;
      if (briefing) body.briefing = briefing;
      if (skipPlanApproval) body.skipPlanApproval = true;
      if (message) body.message = message;
    } else {
      body.message = message;
      if (skipPlanApproval) body.skipPlanApproval = true;
    }

    const res = await fetch(base + "/api/agent", {
      method: "POST",
      headers: await authHeaders(),
      signal,
      body: JSON.stringify(body),
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
        err += " — sign in again or check your account / service token.";
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
      usage: null,
      status: "done",
      interrupted: false,
      runId: null,
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
          if (ev.type === "done") {
            meta.response = ev.response || meta.response;
            meta.usage = ev.usage || meta.usage;
            meta.status = "done";
          }
          if (ev.type === "interrupted") {
            meta.interrupted = true;
            meta.status = "interrupted";
            meta.runId = ev.runId || meta.runId;
            meta.response = ev.response || meta.response;
            meta.usage = ev.usage || meta.usage;
          }
          if (ev.type === "text" && ev.final) meta.response = ev.text;
          if (ev.usage) meta.usage = ev.usage;
          if (ev.runId) meta.runId = ev.runId;
          onEvent && onEvent(ev);
        } catch {
          /* ignore */
        }
      }
    }
    return meta;
  }

  async function companionStatus() {
    const base = apiBase();
    if (!base) return { online: false };
    syncKeyFromUi();
    const res = await fetch(base + "/api/companion", {
      method: "GET",
      headers: await authHeaders(),
    });
    const data = await res.json().catch(function () {
      return null;
    });
    if (!res.ok) {
      return { online: false, error: (data && data.error) || res.status };
    }
    return data || { online: false };
  }

  window.ChatreRemote = {
    enabled,
    hasAuth,
    apiBase,
    apiKey,
    syncKeyFromUi,
    authHeaders,
    health,
    pingAuth,
    getMe,
    patchMe,
    saveByok,
    deleteByok,
    testByok,
    memoryGet,
    memorySet,
    memoryDelete,
    scheduleCreate,
    scheduleList,
    scheduleCancel,
    scheduleDue,
    listModels,
    companionStatus,
    createThread,
    listThreads,
    getThread,
    updateThread,
    deleteThread,
    getMessages,
    getWorkspace,
    exportWorkspace,
    getFile,
    putFile,
    getDiff,
    exec,
    execStream,
    runAgentStream,
  };
})();
