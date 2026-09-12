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
    resumeReason: "",
    threadId: null,
    threadTitle: "",
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
    el.className = "api-status toolbar-pill " + kind;
    el.textContent = label;
    el.title = label;
  }

  function setCompanionStatus(kind, label) {
    const el = $("companion-status");
    if (!el) return;
    el.className = "api-status toolbar-pill " + kind;
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
      if (window.ChatreUIAdv && window.ChatreUIAdv.refreshStatusActions) {
        window.ChatreUIAdv.refreshStatusActions();
      }
      return;
    }
    setStatus("pending", "Checking…");
    const ping = await r.pingAuth();
    if (ping.connected) {
      const firebaseSigned =
        window.ChatreAuth && window.ChatreAuth.isSignedIn();
      if (ping.authKind === "user") {
        const role = ping.role === "admin" ? "Signed in · admin" : "Signed in";
        setStatus("ok", role);
      } else if (firebaseSigned && ping.authKind === "service") {
        setStatus("bad", "Admin key (not user)");
        if (window.ChatreKit) {
          window.ChatreKit.toast(
            "API is using the admin service token. Clear it in Settings so your user session is used.",
            "error",
          );
        }
      } else if (ping.authKind === "service") {
        setStatus("ok", "Admin");
      } else {
        setStatus(
          "ok",
          "Connected" + (ping.backend ? " · " + ping.backend : ""),
        );
      }
    } else if (ping.status === "unauthorized") {
      setStatus("bad", "Sign in");
    } else {
      setStatus("bad", ping.error || "Offline");
    }
    await refreshCompanionStatus();
    if (window.ChatreUIAdv && window.ChatreUIAdv.refreshStatusActions) {
      window.ChatreUIAdv.refreshStatusActions();
    }
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
      "steps " +
      (usage.steps || 0) +
      (usage.remainingSteps != null
        ? "/" + ((usage.steps || 0) + usage.remainingSteps)
        : "") +
      " · ~" +
      (usage.totalTokensEst || 0) +
      " tok";
    el.title =
      model +
      " · steps " +
      (usage.steps || 0) +
      (usage.remainingSteps != null ? " · " + usage.remainingSteps + " left" : "") +
      " · tools " +
      (usage.toolsUsed || 0);
    if (window.ChatreUIAdv && window.ChatreUIAdv.updateBudgetBar) {
      window.ChatreUIAdv.updateBudgetBar(usage);
    }
    if (window.ChatreUX && window.ChatreUX.setBudget) {
      window.ChatreUX.setBudget(usage);
    }
  }

  function setResumeAvailable(on, reason) {
    state.canResume = !!on;
    state.resumeReason = on ? String(reason || "") : "";
    const btn = $("agent-resume");
    if (btn) {
      btn.hidden = true;
      btn.setAttribute("aria-hidden", "true");
      btn.disabled = !on;
    }
    if (window.ChatreComposer && window.ChatreComposer.paintPrimaryButton) {
      window.ChatreComposer.paintPrimaryButton();
    }
    if (on) {
      const run = $("composer-run");
      if (run) {
        run.hidden = false;
        if ($("composer-busy-phase")) {
          $("composer-busy-phase").textContent =
            reason === "awaiting_plan"
              ? "Waiting for plan approval"
              : reason === "awaiting_login"
                ? "Waiting for login — then Resume"
                : reason === "companion_offline"
                  ? "Desktop companion offline"
                  : "Paused — Resume when ready";
        }
      }
    } else if (
      window.ChatreComposer &&
      window.ChatreComposer.syncRunFromUx
    ) {
      window.ChatreComposer.syncRunFromUx();
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
            thr.agentRun.status === "awaiting_plan" ||
            thr.agentRun.status === "awaiting_login");
        const usageHint =
          thr.lastUsage && thr.lastUsage.totalTokensEst
            ? " · ~" + thr.lastUsage.totalTokensEst + " tok"
            : "";
        const status = (thr.agentRun && thr.agentRun.status) || "";
        let statusClass = "done";
        let statusLabel = "Done";
        if (status === "running" || status === "active") {
          statusClass = "running";
          statusLabel = "Running";
        } else if (status === "awaiting_login") {
          statusClass = "login";
          statusLabel = "Needs login";
        } else if (status === "awaiting_plan") {
          statusClass = "plan";
          statusLabel = "Awaiting plan";
        } else if (status === "interrupted" || interrupted) {
          statusClass = "interrupted";
          statusLabel = "Interrupted";
        } else if (!status) {
          statusLabel = "Idle";
          statusClass = "done";
        }
        const goal =
          (thr.agentRun && (thr.agentRun.goal || thr.agentRun.lastGoal)) ||
          thr.lastGoal ||
          thr.preview ||
          "";
        wrap.innerHTML =
          '<button type="button" class="thread-open">' +
          "<strong>" +
          escapeHtml(thr.title || "Untitled") +
          "</strong>" +
          (goal
            ? '<div class="thread-goal">' +
              escapeHtml(String(goal).slice(0, 100)) +
              "</div>"
            : "") +
          '<span class="thread-status ' +
          statusClass +
          '">' +
          escapeHtml(statusLabel) +
          "</span>" +
          "<span>" +
          escapeHtml((thr.updatedAt || "").slice(0, 19).replace("T", " ")) +
          escapeHtml(usageHint) +
          "</span></button>" +
          '<div class="thread-actions">' +
          '<button type="button" class="thread-rename" data-tip="Rename" title="Rename">' +
          (window.ChatreKit
            ? window.ChatreKit.iconHtml("pencil", 14)
            : "✎") +
          "</button>" +
          '<button type="button" class="thread-delete" data-tip="Delete" title="Delete">' +
          (window.ChatreKit ? window.ChatreKit.iconHtml("trash-2", 14) : "×") +
          "</button>" +
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
      if (window.ChatreKit) {
        window.ChatreKit.refreshIcons(list);
        window.ChatreKit.bindTips(list);
      }
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
    state.threadId = threadId;
    state.threadTitle =
      (thr && thr.thread && (thr.thread.title || thr.thread.name)) || "Thread";
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
    if (window.ChatreComposer && window.ChatreComposer.onThreadChange) {
      window.ChatreComposer.onThreadChange();
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
      state.threadId = data.thread.id;
      state.threadTitle = data.thread.title || "New chat";
    }
    setResumeAvailable(false);
    if (window.ChatreUI && window.ChatreUI.resetChat) {
      window.ChatreUI.resetChat([]);
    }
    if (window.ChatreComposer && window.ChatreComposer.onThreadChange) {
      window.ChatreComposer.onThreadChange();
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
        (window.ChatreKit ? window.ChatreKit.iconHtml("file", 13) + " " : "") +
        escapeHtml(p) +
        "</button>" +
        '<button type="button" class="file-ask" data-tip="Explain in chat" title="Explain in chat">' +
        (window.ChatreKit
          ? window.ChatreKit.iconHtml("message-circle-question", 14)
          : "?") +
        "</button>" +
        '<button type="button" class="file-diff" data-tip="Show diff" title="Diff">' +
        (window.ChatreKit
          ? window.ChatreKit.iconHtml("git-compare", 14)
          : "Δ") +
        "</button>" +
        '<button type="button" class="file-dl" data-tip="Download" title="Download">' +
        (window.ChatreKit
          ? window.ChatreKit.iconHtml("download", 14)
          : "↓") +
        "</button>";
      row.querySelector(".file-open").addEventListener("click", () => openFile(p));
      row.querySelector(".file-ask").addEventListener("click", () => askAboutFile(p));
      row.querySelector(".file-diff").addEventListener("click", () => showDiff(p));
      row.querySelector(".file-dl").addEventListener("click", () => downloadFile(p));
      root.appendChild(row);
    });
    if (window.ChatreKit) {
      window.ChatreKit.refreshIcons(root);
      window.ChatreKit.bindTips(root);
    }
  }

  async function openFile(path) {
    state.selectedPath = path;
    const viewer = $("file-viewer");
    const meta = $("file-viewer-path");
    if (!viewer) return;
    const f = state.files[path];
    const content = f && f.content != null ? String(f.content) : "";
    if (meta) meta.textContent = path;
    if (/\.(md|markdown)$/i.test(path) && window.marked && window.DOMPurify) {
      viewer.className = "file-viewer file-preview-md";
      viewer.innerHTML = window.DOMPurify.sanitize(window.marked.parse(content));
    } else {
      viewer.className = "file-viewer";
      viewer.textContent = content;
    }
    if (window.ChatreUIAdv && window.ChatreUIAdv.pushArtifact) {
      window.ChatreUIAdv.pushArtifact({ kind: "file", title: path, path: path });
    }
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

  function syncThreadsToggleUi() {
    const shell = document.querySelector(".app-shell");
    if (!shell) return;
    const mobile =
      window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
    const open = mobile
      ? shell.classList.contains("show-threads")
      : !shell.classList.contains("hide-threads");
    ["toggle-threads", "toggle-threads-bar"].forEach(function (id) {
      const btn = $(id);
      if (!btn) return;
      btn.setAttribute("aria-pressed", open ? "true" : "false");
      btn.classList.toggle("active", open);
    });
    const rail = $("threads-rail");
    if (rail) {
      rail.setAttribute("aria-expanded", open ? "true" : "false");
      rail.hidden = mobile;
    }
  }

  function persistThreadsCollapsed(collapsed) {
    try {
      localStorage.setItem("chatre.threadsCollapsed", collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function readThreadsCollapsed() {
    try {
      return localStorage.getItem("chatre.threadsCollapsed") === "1";
    } catch {
      return false;
    }
  }

  function togglePanel(which) {
    const shell = document.querySelector(".app-shell");
    if (!shell) return;
    const mobile =
      window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
    if (mobile) {
      const cls =
        which === "threads"
          ? "show-threads"
          : which === "files"
            ? "show-files"
            : which === "browser"
              ? "show-browser"
              : "";
      if (!cls) return;
      const on = !shell.classList.contains(cls);
      shell.classList.remove("show-threads", "show-files", "show-browser");
      if (on) shell.classList.add(cls);
      if (which === "threads") syncThreadsToggleUi();
      return;
    }
    if (which === "threads") {
      shell.classList.toggle("hide-threads");
      persistThreadsCollapsed(shell.classList.contains("hide-threads"));
      syncThreadsToggleUi();
    } else if (which === "files") {
      shell.classList.toggle("hide-files");
    } else if (which === "browser") {
      shell.classList.toggle("hide-browser");
    }
  }

  function setThreadsCollapsed(collapsed) {
    const shell = document.querySelector(".app-shell");
    if (!shell) return;
    const mobile =
      window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
    if (mobile) {
      if (collapsed) shell.classList.remove("show-threads");
      else {
        shell.classList.remove("show-files", "show-browser");
        shell.classList.add("show-threads");
      }
    } else {
      shell.classList.toggle("hide-threads", !!collapsed);
      persistThreadsCollapsed(!!collapsed);
    }
    syncThreadsToggleUi();
  }

  function initMobileDefaults() {
    const shell = document.querySelector(".app-shell");
    if (!shell || !window.matchMedia) return;
    if (window.matchMedia("(max-width: 900px)").matches) {
      shell.classList.add("hide-threads", "hide-files", "hide-browser");
      shell.classList.remove("show-threads", "show-files", "show-browser");
    } else {
      shell.classList.add("hide-browser");
      if (readThreadsCollapsed()) shell.classList.add("hide-threads");
      else shell.classList.remove("hide-threads");
    }
    syncThreadsToggleUi();
  }

  let uploadLocalFilesFn = null;

  function init() {
    const refreshBtn = $("threads-refresh");
    const newBtn = $("threads-new");
    const filesRefresh = $("files-refresh");
    const zipBtn = $("files-export-zip");
    const closeDiff = $("diff-modal-close");
    const resumeBtn = $("agent-resume");
    const toggleThreads = $("toggle-threads") || $("toggle-threads-bar");
    const toggleFiles = $("toggle-files") || $("toggle-files-bar");
    const toggleBrowser = $("toggle-browser") || $("toggle-browser-bar");
    const backdrop = $("sheet-backdrop");

    if (refreshBtn) refreshBtn.addEventListener("click", refreshThreads);
    if (newBtn) newBtn.addEventListener("click", newThread);
    if (filesRefresh) filesRefresh.addEventListener("click", refreshFiles);
    if (zipBtn) zipBtn.addEventListener("click", exportZip);

    const drop = $("file-drop");
    const dropInput = $("file-drop-input");
    const progress = $("file-upload-progress");
    async function uploadLocalFiles(fileList) {
      // exposed via ChatrePanels.uploadLocalFiles
      const r = remote();
      if (!r || !r.enabled() || !r.putFile) {
        window.alert("Connect the API key to upload into a remote workspace.");
        return [];
      }
      const wsId = remoteState().workspaceId || state.workspaceId;
      if (!wsId) {
        window.alert("Start an agent chat first so a workspace exists.");
        return [];
      }
      const files = Array.from(fileList || []);
      if (progress) {
        progress.hidden = false;
        progress.textContent = "Uploading 0/" + files.length;
      }
      const paths = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (progress) {
          progress.textContent = "Uploading " + (i + 1) + "/" + files.length + " · " + file.name;
        }
        const text = await file.text();
        const path = "/home/user/uploads/" + file.name.replace(/[^\w.\-]+/g, "_");
        await r.putFile(wsId, path, text, "file");
        paths.push(path);
        if (window.ChatreUIAdv && window.ChatreUIAdv.pushArtifact) {
          window.ChatreUIAdv.pushArtifact({
            kind: "upload",
            title: file.name,
            path: path,
          });
        }
      }
      if (progress) {
        progress.textContent = "Uploaded " + files.length + " file(s)";
        setTimeout(function () {
          progress.hidden = true;
        }, 2000);
      }
      if (window.ChatreKit) {
        window.ChatreKit.toast(
          "Uploaded " + files.length + " file(s)",
          "success",
        );
      }
      await refreshFiles();
      return paths;
    }
    uploadLocalFilesFn = uploadLocalFiles;
    if (drop) {
      drop.addEventListener("click", function () {
        if (dropInput) dropInput.click();
      });
      drop.addEventListener("dragover", function (e) {
        e.preventDefault();
        drop.classList.add("dragover");
      });
      drop.addEventListener("dragleave", function () {
        drop.classList.remove("dragover");
      });
      drop.addEventListener("drop", function (e) {
        e.preventDefault();
        drop.classList.remove("dragover");
        if (e.dataTransfer && e.dataTransfer.files) {
          uploadLocalFiles(e.dataTransfer.files);
        }
      });
    }
    if (dropInput) {
      dropInput.addEventListener("change", function () {
        uploadLocalFiles(dropInput.files);
        dropInput.value = "";
      });
    }
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
    function bindToggle(node, which) {
      if (node) node.addEventListener("click", () => togglePanel(which));
    }
    bindToggle(toggleThreads, "threads");
    bindToggle(toggleFiles, "files");
    bindToggle(toggleBrowser, "browser");
    bindToggle($("toggle-threads-bar"), "threads");
    bindToggle($("toggle-files-bar"), "files");
    bindToggle($("toggle-browser-bar"), "browser");

    const collapseBtn = $("threads-collapse");
    if (collapseBtn) {
      collapseBtn.addEventListener("click", function () {
        setThreadsCollapsed(true);
      });
    }
    const railBtn = $("threads-rail");
    if (railBtn) {
      railBtn.addEventListener("click", function () {
        setThreadsCollapsed(false);
      });
    }
    if (window.matchMedia) {
      window.matchMedia("(max-width: 900px)").addEventListener("change", function () {
        initMobileDefaults();
      });
    }

    if (backdrop) {
      backdrop.addEventListener("click", function () {
        const shell = document.querySelector(".app-shell");
        if (shell) {
          shell.classList.remove("show-threads", "show-files", "show-browser");
        }
      });
    }

    const apiKeyInput = $("api-key-input");
    if (apiKeyInput) {
      apiKeyInput.addEventListener("blur", refreshAuthStatus);
      apiKeyInput.addEventListener("change", refreshAuthStatus);
    }

    initMobileDefaults();
    refreshAuthStatus();
    if (remote() && remote().enabled() && remote().hasAuth && remote().hasAuth()) {
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
    togglePanel,
    setThreadsCollapsed,
    syncThreadsToggleUi,
    uploadLocalFiles: function (files) {
      if (uploadLocalFilesFn) return uploadLocalFilesFn(files);
      return Promise.reject(new Error("Panels not ready"));
    },
    state,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
