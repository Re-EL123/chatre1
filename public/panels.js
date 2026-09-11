/**
 * Chatre panels — threads sidebar, file explorer, diff modal, ZIP export,
 * usage meter, auth status, mobile collapse, rename/delete, explain file.
 */
(function () {
  "use strict";

  const state = {
    threads: [],
    files: {},
    workspaceId: null,
    selectedPath: null,
    fileSnapshots: {},
    usage: null,
    canResume: false,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function remote() {
    return window.ChatreRemote;
  }

  function remoteState() {
    window.__chatreRemote = window.__chatreRemote || {};
    return window.__chatreRemote;
  }

  function setStatus(kind, label) {
    const el = $("api-status");
    if (!el) return;
    el.className = "api-status " + kind;
    el.textContent = label;
    el.title = label;
  }

  function setCompanionStatus(kind, label) {
    const el = $("companion-status");
    if (!el) return;
    el.className = "api-status " + kind;
    el.textContent = label;
    el.title = label;
  }

  async function refreshCompanionStatus() {
    const base = (
      window.CHATRE_COMPANION_URL || "http://127.0.0.1:7843"
    ).replace(/\/$/, "");
    try {
      const res = await fetch(base + "/health", { method: "GET" });
      const data = await res.json().catch(function () {
        return null;
      });
      if (res.ok && data && data.ok) {
        setCompanionStatus(
          "ok",
          data.bridged ? "Desktop · bridged" : "Desktop on",
        );
        return;
      }
      setCompanionStatus("bad", "Desktop error");
    } catch {
      // Also check API bridge status when remote is configured
      try {
        const r = remote();
        if (r && r.enabled() && r.apiKey && r.apiKey()) {
          const st = await r.companionStatus();
          if (st && st.online) {
            setCompanionStatus("ok", "Desktop · bridge");
            return;
          }
        }
      } catch {
        /* ignore */
      }
      setCompanionStatus("off", "Desktop off");
    }
  }

  async function refreshAuthStatus() {
    const r = remote();
    if (!r || !r.enabled()) {
      setStatus("off", "Local");
      await refreshCompanionStatus();
      return;
    }
    setStatus("pending", "Checking…");
    const ping = await r.pingAuth();
    if (ping.connected) {
      setStatus(
        "ok",
        "Connected" + (ping.backend ? " · " + ping.backend : ""),
      );
    } else if (ping.status === "unauthorized") {
      setStatus("bad", "Unauthorized");
    } else {
      setStatus("bad", ping.error || "Offline");
    }
    await refreshCompanionStatus();
  }

  function updateUsageMeter(usage) {
    state.usage = usage || null;
    const el = $("usage-meter");
    if (!el) return;
    if (!usage) {
      el.textContent = "";
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const model = (usage.model || "model").replace(/^@cf\//, "");
    el.textContent =
      model +
      " · steps " +
      (usage.steps || 0) +
      " · tools " +
      (usage.toolsUsed || 0) +
      " · ~" +
      (usage.totalTokensEst || 0) +
      " tok";
  }

  function setResumeAvailable(on, reason) {
    state.canResume = !!on;
    const btn = $("agent-resume");
    if (!btn) return;
    btn.hidden = !on;
    btn.disabled = !on;
    if (on) {
      btn.classList.add("pulse");
      btn.title =
        reason === "awaiting_plan"
          ? "Approve or edit the plan, then continue"
          : "Resume interrupted agent run";
      btn.textContent =
        reason === "awaiting_plan" ? "Continue plan" : "Resume agent";
    } else {
      btn.classList.remove("pulse");
      btn.textContent = "Resume";
    }
  }

  async function refreshThreads() {
    const list = $("thread-list");
    if (!list || !remote() || !remote().enabled()) return;
    try {
      const data = await remote().listThreads();
      state.threads = data.threads || [];
      list.innerHTML = "";
      if (!state.threads.length) {
        list.innerHTML = '<p class="panel-empty">No saved threads yet.</p>';
        return;
      }
      const active = remoteState().threadId;
      state.threads.forEach((thr) => {
        const wrap = document.createElement("div");
        wrap.className =
          "thread-item" + (thr.id === active ? " active" : "");
        const interrupted =
          thr.agentRun &&
          (thr.agentRun.status === "interrupted" ||
            thr.agentRun.status === "awaiting_plan");
        const usageHint =
          thr.lastUsage && thr.lastUsage.totalTokensEst
            ? " · ~" + thr.lastUsage.totalTokensEst + " tok"
            : "";
        wrap.innerHTML =
          '<button type="button" class="thread-open">' +
          "<strong>" +
          escapeHtml(thr.title || "Untitled") +
          "</strong><span>" +
          escapeHtml((thr.updatedAt || "").slice(0, 19).replace("T", " ")) +
          (interrupted ? " · interrupted" : "") +
          escapeHtml(usageHint) +
          "</span></button>" +
          '<div class="thread-actions">' +
          '<button type="button" class="thread-rename" title="Rename">✎</button>' +
          '<button type="button" class="thread-delete" title="Delete">×</button>' +
          "</div>";
        wrap.querySelector(".thread-open").addEventListener("click", () => {
          loadThread(thr.id);
        });
        wrap
          .querySelector(".thread-rename")
          .addEventListener("click", (e) => {
            e.stopPropagation();
            renameThread(thr);
          });
        wrap
          .querySelector(".thread-delete")
          .addEventListener("click", (e) => {
            e.stopPropagation();
            deleteThread(thr);
          });
        list.appendChild(wrap);
      });
    } catch (e) {
      list.innerHTML =
        '<p class="panel-empty">' + escapeHtml(e.message || String(e)) + "</p>";
    }
  }

  async function loadThread(threadId) {
    if (!remote()) return;
    const data = await remote().getMessages(threadId);
    const thr = await remote().getThread(threadId);
    remoteState().threadId = threadId;
    if (thr && thr.thread && thr.thread.workspaceId) {
      remoteState().workspaceId = thr.thread.workspaceId;
      state.workspaceId = thr.thread.workspaceId;
    }
    if (thr && thr.thread && thr.thread.lastUsage) {
      updateUsageMeter(thr.thread.lastUsage);
    }
    const interrupted =
      thr &&
      thr.thread &&
      thr.thread.agentRun &&
      thr.thread.agentRun.status === "interrupted";
    setResumeAvailable(interrupted);
    if (window.ChatreUI && window.ChatreUI.resetChat) {
      window.ChatreUI.resetChat(data.messages || []);
    }
    await refreshThreads();
    await refreshFiles();
  }

  async function newThread() {
    if (!remote() || !remote().enabled()) return;
    const modelEl = $("model-select");
    const data = await remote().createThread(
      "New chat",
      modelEl ? modelEl.value : "",
    );
    if (data.thread) {
      remoteState().threadId = data.thread.id;
      remoteState().workspaceId = data.workspace && data.workspace.id;
      state.workspaceId = remoteState().workspaceId;
    }
    setResumeAvailable(false);
    if (window.ChatreUI && window.ChatreUI.resetChat) {
      window.ChatreUI.resetChat([]);
    }
    await refreshThreads();
    await refreshFiles();
  }

  async function renameThread(thr) {
    if (!remote()) return;
    const next = window.prompt("Rename thread", thr.title || "Untitled");
    if (next == null) return;
    const title = String(next).trim();
    if (!title) return;
    await remote().updateThread(thr.id, { title: title.slice(0, 120) });
    await refreshThreads();
  }

  async function deleteThread(thr) {
    if (!remote()) return;
    if (!window.confirm('Delete thread "' + (thr.title || "Untitled") + '"?')) {
      return;
    }
    await remote().deleteThread(thr.id);
    if (remoteState().threadId === thr.id) {
      remoteState().threadId = null;
      remoteState().workspaceId = null;
      state.workspaceId = null;
      setResumeAvailable(false);
      if (window.ChatreUI && window.ChatreUI.resetChat) {
        window.ChatreUI.resetChat([]);
      }
    }
    await refreshThreads();
    await refreshFiles();
  }

  async function refreshFiles() {
    const tree = $("file-tree");
    if (!tree || !remote() || !remote().enabled()) return;
    const wsId = remoteState().workspaceId || state.workspaceId || null;
    if (!wsId) {
      tree.innerHTML =
        '<p class="panel-empty">No workspace yet — start an agent chat.</p>';
      return;
    }
    try {
      const data = await remote().getWorkspace(wsId);
      if (data.workspace) {
        state.workspaceId = data.workspace.id;
        remoteState().workspaceId = data.workspace.id;
      }
      state.files = data.files || {};
      renderFileTree(tree, state.files);
    } catch (e) {
      tree.innerHTML =
        '<p class="panel-empty">' + escapeHtml(e.message || String(e)) + "</p>";
    }
  }

  function renderFileTree(root, files) {
    root.innerHTML = "";
    const paths = Object.keys(files || {})
      .filter((p) => files[p] && files[p].type === "file")
      .sort();
    if (!paths.length) {
      root.innerHTML = '<p class="panel-empty">No files in workspace.</p>';
      return;
    }
    paths.forEach((p) => {
      const row = document.createElement("div");
      row.className =
        "file-item" + (state.selectedPath === p ? " active" : "");
      row.innerHTML =
        '<button type="button" class="file-open">' +
        escapeHtml(p) +
        "</button>" +
        '<button type="button" class="file-ask" title="Explain in chat">?</button>' +
        '<button type="button" class="file-diff" title="Diff">Δ</button>' +
        '<button type="button" class="file-dl" title="Download">↓</button>';
      row.querySelector(".file-open").addEventListener("click", () => openFile(p));
      row.querySelector(".file-ask").addEventListener("click", () => askAboutFile(p));
      row.querySelector(".file-diff").addEventListener("click", () => showDiff(p));
      row.querySelector(".file-dl").addEventListener("click", () => downloadFile(p));
      root.appendChild(row);
    });
  }

  async function openFile(path) {
    state.selectedPath = path;
    const viewer = $("file-viewer");
    const meta = $("file-viewer-path");
    if (!viewer) return;
    const f = state.files[path];
    const content = f && f.content != null ? f.content : "";
    viewer.textContent = content;
    if (meta) meta.textContent = path;
    await refreshFiles();
  }

  function askAboutFile(path) {
    const f = state.files[path];
    const snippet =
      f && f.content != null
        ? String(f.content).slice(0, 4000)
        : "(empty or unread)";
    const prompt =
      "Explain this file and suggest improvements:\n\nPath: " +
      path +
      "\n\n```\n" +
      snippet +
      "\n```";
    if (window.ChatreUI && window.ChatreUI.composeAndSend) {
      window.ChatreUI.composeAndSend(prompt);
      return;
    }
    const input = $("user-input");
    if (input) {
      input.value = prompt;
      input.focus();
    }
  }

  function downloadFile(path) {
    const f = state.files[path];
    if (!f) return;
    const blob = new Blob([f.content || ""], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = path.split("/").pop() || "file.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function showDiff(path) {
    const modal = $("diff-modal");
    const body = $("diff-modal-body");
    const title = $("diff-modal-title");
    if (!modal || !body) return;
    if (title) title.textContent = "Diff · " + path;
    body.textContent = "Loading…";
    modal.classList.add("open");

    const wsId = remoteState().workspaceId || state.workspaceId;
    try {
      if (remote() && remote().getDiff && wsId) {
        const data = await remote().getDiff(wsId, path);
        body.textContent =
          data.unified ||
          makeUnifiedDiff(data.previous || "", data.current || "", path);
        return;
      }
    } catch (e) {
      body.textContent = "Server diff failed: " + (e.message || e) + "\n\n";
    }

    const f = state.files[path];
    const previous =
      f && f.previousContent != null
        ? f.previousContent
        : state.fileSnapshots[path] != null
          ? state.fileSnapshots[path]
          : "";
    const current = (f && f.content) || "";
    body.textContent =
      (body.textContent || "") + makeUnifiedDiff(previous, current, path);
  }

  function makeUnifiedDiff(a, b, path) {
    const aLines = String(a).split("\n");
    const bLines = String(b).split("\n");
    const out = ["--- a/" + path, "+++ b/" + path];
    const max = Math.max(aLines.length, bLines.length);
    for (let i = 0; i < max; i++) {
      const left = aLines[i];
      const right = bLines[i];
      if (left === right) {
        if (left !== undefined) out.push(" " + left);
      } else {
        if (left !== undefined) out.push("-" + left);
        if (right !== undefined) out.push("+" + right);
      }
    }
    return out.join("\n");
  }

  async function exportZip() {
    if (!remote() || !remote().enabled()) {
      alert("Remote API not configured");
      return;
    }
    const wsId = remoteState().workspaceId || state.workspaceId;
    if (!wsId) {
      alert("No workspace yet — start an agent chat first.");
      return;
    }
    if (!window.JSZip) {
      alert("JSZip not loaded");
      return;
    }
    const data = await remote().exportWorkspace(wsId);
    const zip = new JSZip();
    const files = data.files || {};
    Object.keys(files).forEach((p) => {
      const rel = p.replace(/^\//, "");
      zip.file(rel || "file.txt", files[p] || "");
    });
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download =
      "chatre-workspace-" +
      (data.workspace && data.workspace.id
        ? data.workspace.id.slice(0, 12)
        : "export") +
      ".zip";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function rememberWrite(path, previous, next) {
    if (previous != null && state.fileSnapshots[path] == null) {
      state.fileSnapshots[path] = previous;
    }
    if (next != null) {
      if (!state.files[path]) {
        state.files[path] = {
          path: path,
          type: "file",
          content: next,
          previousContent: previous,
        };
      } else {
        if (previous != null) state.files[path].previousContent = previous;
        state.files[path].content = next;
      }
    }
  }

  function togglePanel(which) {
    const shell = document.querySelector(".app-shell");
    if (!shell) return;
    if (which === "threads") {
      shell.classList.toggle("hide-threads");
    } else if (which === "files") {
      shell.classList.toggle("hide-files");
    }
  }

  function initMobileDefaults() {
    const shell = document.querySelector(".app-shell");
    if (!shell || !window.matchMedia) return;
    if (window.matchMedia("(max-width: 960px)").matches) {
      shell.classList.add("hide-threads", "hide-files");
    }
  }

  function init() {
    const refreshBtn = $("threads-refresh");
    const newBtn = $("threads-new");
    const filesRefresh = $("files-refresh");
    const zipBtn = $("files-export-zip");
    const closeDiff = $("diff-modal-close");
    const resumeBtn = $("agent-resume");
    const toggleThreads = $("toggle-threads");
    const toggleFiles = $("toggle-files");

    if (refreshBtn) refreshBtn.addEventListener("click", refreshThreads);
    if (newBtn) newBtn.addEventListener("click", newThread);
    if (filesRefresh) filesRefresh.addEventListener("click", refreshFiles);
    if (zipBtn) zipBtn.addEventListener("click", exportZip);
    if (closeDiff) {
      closeDiff.addEventListener("click", () => {
        $("diff-modal").classList.remove("open");
      });
    }
    if (resumeBtn) {
      resumeBtn.addEventListener("click", () => {
        if (window.ChatreUI && window.ChatreUI.resumeAgent) {
          window.ChatreUI.resumeAgent();
        }
      });
    }
    if (toggleThreads) {
      toggleThreads.addEventListener("click", () => togglePanel("threads"));
    }
    if (toggleFiles) {
      toggleFiles.addEventListener("click", () => togglePanel("files"));
    }

    const apiKeyInput = $("api-key-input");
    if (apiKeyInput) {
      apiKeyInput.addEventListener("blur", refreshAuthStatus);
      apiKeyInput.addEventListener("change", refreshAuthStatus);
    }

    initMobileDefaults();
    refreshAuthStatus();
    if (remote() && remote().enabled() && remote().apiKey()) {
      refreshThreads();
      refreshFiles();
    }

    setInterval(refreshAuthStatus, 60000);
  }

  window.ChatrePanels = {
    init,
    refreshAuthStatus,
    refreshThreads,
    refreshFiles,
    updateUsageMeter,
    rememberWrite,
    setResumeAvailable,
    askAboutFile,
    state,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
