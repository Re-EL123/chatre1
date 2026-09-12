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
    revision: 0,
    selectedPath: null,
    activeProject: null,
    projects: {},
    expanded: {},
    fileSnapshots: {},
    usage: null,
    canResume: false,
    resumeReason: "",
    threadId: null,
    threadTitle: "",
    repo: null,
    repoBranch: null,
    repoDirty: null,
    testsOk: null,
    lastTest: null,
    openTabs: [],
    viewerMode: "source",
    problems: [],
    problemCount: 0,
    lastDiagnostics: null,
    runConfigs: null,
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
    if (window.ChatreComposerFlow && window.ChatreComposerFlow.paintMicroActions) {
      window.ChatreComposerFlow.paintMicroActions();
    }
    if (on) {
      const run = $("composer-run");
      if (run) {
        run.hidden = false;
        if ($("composer-busy-phase")) {
          $("composer-busy-phase").textContent =
            reason === "awaiting_plan"
              ? "Waiting for plan approval"
              : reason === "awaiting_approval"
                ? "Waiting for tool approval — then Resume"
                : reason === "awaiting_login"
                ? "Waiting for login — then Resume"
                : reason === "awaiting_clarify"
                  ? "Waiting for your choice"
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
            thr.agentRun.status === "awaiting_login" ||
            thr.agentRun.status === "awaiting_clarify" ||
            thr.agentRun.status === "awaiting_approval");
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
        } else if (status === "awaiting_clarify") {
          statusClass = "plan";
          statusLabel = "Needs choice";
        } else if (status === "awaiting_plan") {
          statusClass = "plan";
          statusLabel = "Awaiting plan";
        } else if (status === "awaiting_approval") {
          statusClass = "plan";
          statusLabel = "Needs approval";
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
      if (window.ChatreMotion) {
        window.ChatreMotion.staggerChildren(list, "file", 22);
      }
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
    if (!tree) return;

    // Signed-in remote workspace
    if (remote() && remote().enabled()) {
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
        if (data.revision != null) state.revision = data.revision;
        else if (data.workspace && data.workspace.revision != null) {
          state.revision = data.workspace.revision;
        }
        if (data.workspace) {
          state.activeProject = data.workspace.activeProject || null;
          state.projects = data.workspace.projects || {};
        }
        if (window.ChatreProjects) {
          const detected = window.ChatreProjects.detectProjects(state.files);
          state.projects = detected;
          const metaActive = data.workspace && data.workspace.activeProject;
          if (metaActive && detected[metaActive]) {
            state.activeProject = metaActive;
          } else if (
            !state.activeProject &&
            Object.keys(detected).length === 1
          ) {
            state.activeProject = Object.keys(detected)[0];
          } else if (state.activeProject && !detected[state.activeProject]) {
            state.activeProject = null;
          }
        }
        loadOpenTabs();
        await refreshRepoStatus(wsId);
        await refreshDiagnostics(wsId);
        renderFileTree(tree, state.files);
        renderFileTabs();
      } catch (e) {
        tree.innerHTML =
          '<p class="panel-empty">' + escapeHtml(e.message || String(e)) + "</p>";
      }
      return;
    }

    // Local virtual filesystem (Worker / offline agent)
    const localFs = (window.ChatreCore && window.ChatreCore.fs) || {};
    const files = {};
    Object.keys(localFs).forEach(function (p) {
      if (localFs[p] && localFs[p].type === "file") files[p] = localFs[p];
    });
    state.files = files;
    renderFileTree(tree, state.files);
  }

  async function refreshRepoStatus(wsIdOpt) {
    const r = remote();
    if (!r || !r.enabled() || typeof r.getRepo !== "function") return null;
    const wsId =
      wsIdOpt || remoteState().workspaceId || state.workspaceId || null;
    if (!wsId) return null;
    try {
      const data = await r.getRepo(wsId);
      state.repo = (data && data.repo) || null;
      state.repoBranch = (data && data.branch) || null;
      state.repoDirty =
        data && data.dirty != null ? data.dirty : null;
      state.testsOk = data ? !!data.testsOk : null;
      state.lastTest = (data && data.lastTest) || null;
      state.lastDiagnostics = (data && data.lastDiagnostics) || state.lastDiagnostics;
      state.problemCount =
        data && data.problemCount != null
          ? data.problemCount
          : state.lastDiagnostics &&
              Array.isArray(state.lastDiagnostics.problems)
            ? state.lastDiagnostics.problems.length
            : state.problemCount;
      if (data && Array.isArray(data.runConfigs)) {
        state.runConfigs = data.runConfigs;
      }
      if (data && data.status && data.status.head) {
        state.repoHead = data.status.head;
      } else {
        state.repoHead = (data && data.head) || null;
      }
      return data;
    } catch (e) {
      return null;
    }
  }

  
  function tabsStorageKey() {
    const id = remoteState().workspaceId || state.workspaceId || "local";
    return "chatre.openTabs." + id;
  }

  function loadOpenTabs() {
    try {
      const raw = sessionStorage.getItem(tabsStorageKey());
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) state.openTabs = arr.map(String).slice(0, 12);
    } catch (e) {}
  }

  function saveOpenTabs() {
    try {
      sessionStorage.setItem(
        tabsStorageKey(),
        JSON.stringify((state.openTabs || []).slice(0, 12)),
      );
    } catch (e) {}
  }

  function ensureTab(path) {
    if (!path) return;
    const tabs = state.openTabs || [];
    const i = tabs.indexOf(path);
    if (i >= 0) tabs.splice(i, 1);
    tabs.unshift(path);
    state.openTabs = tabs.slice(0, 12);
    saveOpenTabs();
  }

  function closeTab(path) {
    state.openTabs = (state.openTabs || []).filter(function (p) {
      return p !== path;
    });
    saveOpenTabs();
    if (state.selectedPath === path) {
      state.selectedPath = state.openTabs[0] || null;
      if (state.selectedPath) openFile(state.selectedPath);
      else {
        const viewer = $("file-viewer");
        const meta = $("file-viewer-path");
        if (viewer) viewer.textContent = "";
        if (meta) meta.textContent = "";
        renderFileTabs();
      }
    } else {
      renderFileTabs();
    }
  }

  function basename(path) {
    const s = String(path || "");
    const i = s.lastIndexOf("/");
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function syncActiveFileChip(path) {
    if (!window.ChatreComposer || !window.ChatreComposer.addAttachment) return;
    if (!path) return;
    if (typeof window.ChatreComposer.removeAttachment === "function") {
      try {
        const chips =
          (window.ChatreComposer.state &&
            window.ChatreComposer.state.attachments) ||
          [];
        chips
          .filter(function (a) {
            return a && String(a.id || "").indexOf("active-file:") === 0;
          })
          .forEach(function (a) {
            window.ChatreComposer.removeAttachment(a.id);
          });
      } catch (e) {
        /* ignore */
      }
    }
    window.ChatreComposer.addAttachment({
      kind: "file",
      label: basename(path),
      path: path,
      id: "active-file:" + path,
    });
  }

  function detectLocalRunConfigs() {
    const slug = state.activeProject;
    if (!slug) return [];
    const pkgPath = "/home/user/projects/" + slug + "/package.json";
    const f = state.files[pkgPath];
    const configs = [];
    if (f && f.content) {
      try {
        const j = JSON.parse(f.content);
        const scripts = (j && j.scripts) || {};
        if (scripts.test) {
          configs.push({ id: "test", label: "Test", cmd: "npm test", kind: "test" });
        }
        if (scripts.lint) {
          configs.push({ id: "lint", label: "Lint", cmd: "npm run lint", kind: "lint" });
        }
      } catch (e) {}
    }
    configs.push({
      id: "diagnose",
      label: "Diagnose",
      cmd: null,
      kind: "diagnose",
      tool: "repo_diagnostics",
    });
    return configs;
  }

  function seedAgentMessage(msg) {
    const input =
      $("chat-input") ||
      $("user-input") ||
      document.querySelector("textarea#chat-input");
    if (input) {
      input.value = msg;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    }
    if (window.ChatreChat && typeof window.ChatreChat.sendMessage === "function") {
      window.ChatreChat.sendMessage(msg);
    } else if (window.ChatreUI && window.ChatreUI.composeAndSend) {
      window.ChatreUI.composeAndSend(msg);
    } else if (
      window.ChatreCore &&
      typeof window.ChatreCore.sendUserMessage === "function"
    ) {
      window.ChatreCore.sendUserMessage(msg);
    }
  }

  async function runConfig(cfg) {
    if (!cfg) return;
    if (cfg.kind === "diagnose" || cfg.tool === "repo_diagnostics") {
      seedAgentMessage(
        "Run repo_diagnostics on the active project, then summarize Problems.",
      );
      return;
    }
    const cwd = state.activeProject
      ? "/home/user/projects/" + state.activeProject
      : null;
    const wsId = remoteState().workspaceId || state.workspaceId;
    if (remote() && remote().enabled() && remote().exec && wsId && cfg.cmd) {
      try {
        await remote().exec(cfg.cmd, wsId, cwd, { mode: "workspace", timeoutMs: 180000 });
        await refreshRepoStatus();
        await refreshDiagnostics();
        const tree = $("file-tree");
        if (tree) renderFileTree(tree, state.files);
        return;
      } catch (e) {}
    }
    seedAgentMessage(
      "In the active project, run `" +
        cfg.cmd +
        "` via run_tests or execute_command (cwd project root), then report results.",
    );
  }

  async function refreshDiagnostics(wsIdOpt) {
    const r = remote();
    if (!r || !r.enabled() || typeof r.getDiagnostics !== "function") return null;
    const wsId =
      wsIdOpt || remoteState().workspaceId || state.workspaceId || null;
    if (!wsId) return null;
    try {
      const data = await r.getDiagnostics(wsId);
      state.lastDiagnostics = (data && data.lastDiagnostics) || null;
      state.problems =
        (data && Array.isArray(data.problems) && data.problems) ||
        (state.lastDiagnostics && state.lastDiagnostics.problems) ||
        [];
      state.problemCount = state.problems.length;
      if (data && data.testsOk != null) state.testsOk = !!data.testsOk;
      if (data && data.lastTest) state.lastTest = data.lastTest;
      if (data && Array.isArray(data.runConfigs)) state.runConfigs = data.runConfigs;
      return data;
    } catch (e) {
      return null;
    }
  }

  function applyProblemsEvent(ev) {
    if (!ev) return;
    state.problems = Array.isArray(ev.problems) ? ev.problems : [];
    state.problemCount = state.problems.length;
    if (ev.lastDiagnostics) state.lastDiagnostics = ev.lastDiagnostics;
    if (ev.testsOk != null) state.testsOk = !!ev.testsOk;
    if (ev.lastTest) state.lastTest = ev.lastTest;
    if (Array.isArray(ev.runConfigs)) state.runConfigs = ev.runConfigs;
    const tree = $("file-tree");
    if (tree) renderFileTree(tree, state.files);
  }

  function renderFileTabs() {
    const host = $("ide-file-tabs");
    const toolbar = $("ide-viewer-toolbar");
    if (!host) return;
    const tabs = state.openTabs || [];
    if (!tabs.length) {
      host.hidden = true;
      host.innerHTML = "";
      if (toolbar) toolbar.hidden = true;
      return;
    }
    host.hidden = false;
    if (toolbar) toolbar.hidden = !state.selectedPath;
    host.innerHTML = "";
    tabs.forEach(function (path) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "ide-file-tab" + (state.selectedPath === path ? " active" : "");
      btn.title = path;
      btn.innerHTML =
        '<span class="ide-file-tab-name">' +
        escapeHtml(basename(path)) +
        '</span><span class="ide-file-tab-close" data-close="1" title="Close">×</span>';
      btn.addEventListener("click", function (e) {
        if (e.target && e.target.getAttribute("data-close")) {
          e.stopPropagation();
          closeTab(path);
          return;
        }
        openFile(path);
      });
      host.appendChild(btn);
    });
    if (toolbar && !toolbar._bound) {
      toolbar._bound = true;
      toolbar.addEventListener("click", function (e) {
        const el = e.target;
        if (!el || !el.getAttribute) return;
        const mode = el.getAttribute("data-mode");
        if (!mode) return;
        state.viewerMode = mode;
        Array.prototype.forEach.call(
          toolbar.querySelectorAll(".ide-view-mode"),
          function (b) {
            b.classList.toggle("active", b.getAttribute("data-mode") === mode);
          },
        );
        if (state.selectedPath) openFile(state.selectedPath);
      });
    }
  }

  function renderProblemsPanel(root) {
    const problems = state.problems || [];
    const wrap = document.createElement("div");
    wrap.className = "ide-problems";
    wrap.innerHTML =
      '<div class="ide-problems-head"><span>Problems</span>' +
      '<button type="button" class="ide-repo-refresh ide-problems-refresh" title="Refresh diagnostics">↻</button></div>';
    if (!problems.length) {
      const empty = document.createElement("p");
      empty.className = "panel-empty";
      empty.style.fontSize = "0.72rem";
      empty.textContent = "No problems recorded — run Diagnose.";
      wrap.appendChild(empty);
    } else {
      problems.slice(0, 40).forEach(function (pr) {
        const row = document.createElement("button");
        row.type = "button";
        row.className =
          "ide-problem-row " +
          (pr.severity === "warning" ? "warning" : "error");
        const loc =
          (pr.file ? basename(pr.file) : "?") +
          ":" +
          (pr.line || 1);
        row.textContent =
          loc + " · " + String(pr.message || "").slice(0, 120);
        row.title = (pr.file || "") + " — " + (pr.message || "");
        row.addEventListener("click", function () {
          if (pr.file) openFile(pr.file);
        });
        wrap.appendChild(row);
      });
    }
    const refresh = wrap.querySelector(".ide-problems-refresh");
    if (refresh) {
      refresh.addEventListener("click", async function () {
        await refreshDiagnostics();
        const tree = $("file-tree");
        if (tree) renderFileTree(tree, state.files);
      });
    }
    root.appendChild(wrap);
  }

  function renderDiffHtml(unified) {
    const lines = String(unified || "").split("\n");
    return lines
      .map(function (line) {
        let cls = "";
        if (line.charAt(0) === "+" && line.indexOf("+++") !== 0) cls = "ide-diff-add";
        else if (line.charAt(0) === "-" && line.indexOf("---") !== 0)
          cls = "ide-diff-del";
        else if (line.indexOf("@@") === 0 || line.indexOf("diff") === 0)
          cls = "ide-diff-meta";
        return (
          '<div class="' +
          cls +
          '">' +
          escapeHtml(line) +
          "</div>"
        );
      })
      .join("");
  }

function seedCloneChat(url) {
    const u = String(url || "").trim();
    if (!u) return;
    const msg =
      "Clone this repo with git_clone, explore with search_code, then run_tests: " +
      u;
    const input = $("chat-input") || document.querySelector("textarea#chat-input");
    if (input) {
      input.value = msg;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    }
    if (window.ChatreChat && typeof window.ChatreChat.sendMessage === "function") {
      window.ChatreChat.sendMessage(msg);
    } else if (
      window.ChatreCore &&
      typeof window.ChatreCore.sendUserMessage === "function"
    ) {
      window.ChatreCore.sendUserMessage(msg);
    }
  }

  function renderRepoBar(root) {
    const bar = document.createElement("div");
    bar.className = "ide-repo-bar";
    const branch = state.repoBranch || (state.repo && state.repo.branch) || "—";
    const dirty =
      state.repoDirty != null
        ? state.repoDirty
        : state.repo && state.repo.dirty != null
          ? state.repo.dirty
          : null;
    const dirtyLabel =
      dirty == null ? "·" : dirty === 0 ? "clean" : dirty + " dirty";
    let testLabel = "tests —";
    let testClass = "";
    if (state.lastTest && state.lastTest.skipped) {
      testLabel = "tests skip";
      testClass = "skip";
    } else if (state.testsOk === true) {
      testLabel = "tests ✓";
      testClass = "pass";
    } else if (state.testsOk === false && state.lastTest) {
      testLabel = "tests ✗";
      testClass = "fail";
    }
    const pc = state.problemCount || (state.problems && state.problems.length) || 0;
    const probLabel = pc ? pc + " problems" : "0 problems";
    const probClass = pc ? "warn" : "ok";
    const hasRepo = !!(state.repo && state.repo.mode === "git");
    const configs =
      (Array.isArray(state.runConfigs) && state.runConfigs.length
        ? state.runConfigs
        : detectLocalRunConfigs()) || [];
    bar.innerHTML =
      '<div class="ide-repo-row">' +
      '<span class="ide-repo-branch" title="Branch">' +
      (window.ChatreKit ? window.ChatreKit.iconHtml("git-branch", 12) + " " : "") +
      escapeHtml(String(branch)) +
      "</span>" +
      '<span class="ide-repo-dirty">' +
      escapeHtml(dirtyLabel) +
      "</span>" +
      '<span class="ide-repo-tests ' +
      testClass +
      '">' +
      escapeHtml(testLabel) +
      "</span>" +
      '<span class="ide-repo-problems ' +
      probClass +
      '">' +
      escapeHtml(probLabel) +
      "</span>" +
      '<button type="button" class="ide-repo-refresh" title="Refresh status">↻</button>' +
      "</div>" +
      '<div class="ide-run-strip"></div>' +
      (hasRepo
        ? ""
        : '<div class="ide-repo-clone">' +
          '<input type="url" class="ide-repo-url" placeholder="https://github.com/org/repo" />' +
          '<button type="button" class="ide-repo-clone-btn">Clone</button>' +
          "</div>");
    const strip = bar.querySelector(".ide-run-strip");
    if (strip) {
      configs.forEach(function (cfg) {
        if (cfg.kind === "dev") return;
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ide-run-btn";
        b.textContent = cfg.label || cfg.id;
        b.title = cfg.cmd || cfg.tool || cfg.label;
        b.addEventListener("click", function () {
          runConfig(cfg);
        });
        strip.appendChild(b);
      });
      if (hasRepo) {
        const prBtn = document.createElement("button");
        prBtn.type = "button";
        prBtn.className = "ide-run-btn";
        prBtn.textContent = "Create PR";
        prBtn.title = "Ask the agent to open a GitHub pull request";
        prBtn.addEventListener("click", function () {
          const br = state.repoBranch || (state.repo && state.repo.branch) || "HEAD";
          seedAgentMessage(
            "Open a GitHub pull request for branch `" +
              br +
              "` with create_pull_request (title summarizing the changes, body with summary + test plan). Ensure run_tests / get_ci_status as needed. Push only if required and approved.",
          );
        });
        strip.appendChild(prBtn);
      }
    }
    const refreshBtn = bar.querySelector(".ide-repo-refresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async function () {
        await refreshRepoStatus();
        await refreshDiagnostics();
        const tree = $("file-tree");
        if (tree) renderFileTree(tree, state.files);
      });
    }
    const cloneBtn = bar.querySelector(".ide-repo-clone-btn");
    const urlInput = bar.querySelector(".ide-repo-url");
    if (cloneBtn && urlInput) {
      cloneBtn.addEventListener("click", function () {
        seedCloneChat(urlInput.value);
      });
      urlInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          seedCloneChat(urlInput.value);
        }
      });
    }
    root.appendChild(bar);
  }

function renderFileTree(root, files) {
    root.innerHTML = "";
    const map = files || {};
    const detected =
      (window.ChatreProjects && window.ChatreProjects.detectProjects(map)) ||
      {};
    // Prefer on-disk projects; only enrich meta for slugs that actually exist
    const projects = Object.assign({}, detected);
    Object.keys(state.projects || {}).forEach(function (slug) {
      if (detected[slug]) {
        projects[slug] = Object.assign({}, state.projects[slug], detected[slug]);
      }
    });
    state.projects = projects;
    // Clear stale Active when meta points at a project with no files
    if (state.activeProject && !projects[state.activeProject]) {
      state.activeProject = null;
    }
    const slugs = Object.keys(projects).sort();
    state.roots = slugs.slice();

    const head = document.createElement("div");
    head.className = "ide-explorer-head";
    head.innerHTML =
      '<div class="ide-explorer-title">Explorer</div>' +
      '<div class="ide-active-project">' +
      (state.activeProject
        ? 'Active: <strong>' + escapeHtml(state.activeProject) + "</strong>"
        : "No active project") +
      (slugs.length > 1
        ? ' · roots: ' + escapeHtml(slugs.join(", "))
        : "") +
      "</div>";
    head.title = "Right-click to export the workspace";
    head.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      openExplorerMenu(e.clientX, e.clientY, {
        kind: "workspace",
        path: "/home/user",
        name: "workspace",
      });
    });
    root.appendChild(head);
    renderRepoBar(root);
    renderProblemsPanel(root);

    if (slugs.length) {
      const projSec = document.createElement("div");
      projSec.className = "ide-section";
      projSec.innerHTML = '<div class="ide-section-label">Projects</div>';
      slugs.forEach(function (slug) {
        const p = projects[slug];
        const row = document.createElement("button");
        row.type = "button";
        row.className =
          "ide-project-chip" +
          (state.activeProject === slug ? " active" : "");
        row.innerHTML =
          (window.ChatreKit
            ? window.ChatreKit.iconHtml("folder-git-2", 13) + " "
            : "") +
          escapeHtml(slug) +
          (p.hasAgentsMd
            ? ' <span class="ide-badge">AGENTS</span>'
            : "") +
          (p.fileCount
            ? ' <span class="ide-count">' + p.fileCount + "</span>"
            : "");
        row.title = "Set active project " + (p.root || slug);
        row.addEventListener("click", function () {
          setActiveProject(slug);
        });
        row.addEventListener("contextmenu", function (e) {
          e.preventDefault();
          e.stopPropagation();
          openExplorerMenu(e.clientX, e.clientY, {
            kind: "project",
            path: p.root || "/home/user/projects/" + slug,
            name: slug,
            slug: slug,
          });
        });
        projSec.appendChild(row);
      });
      root.appendChild(projSec);
    }

    const treeHost = document.createElement("div");
    treeHost.className = "ide-tree";
    const treeRoot =
      window.ChatreProjects && window.ChatreProjects.buildTree
        ? window.ChatreProjects.buildTree(map, "/home/user")
        : null;

    if (!treeRoot || !treeRoot.children || !treeRoot.children.length) {
      const empty = document.createElement("p");
      empty.className = "panel-empty";
      empty.textContent =
        "No files yet — ask the agent to create a project under /home/user/projects.";
      treeHost.appendChild(empty);
    } else {
      renderTreeNode(treeHost, treeRoot, 0);
    }
    root.appendChild(treeHost);

    if (window.ChatreKit) {
      window.ChatreKit.refreshIcons(root);
      window.ChatreKit.bindTips(root);
    }
    if (window.ChatreMotion) {
      window.ChatreMotion.staggerChildren(treeHost, "file", 18);
    }
  }

  function renderTreeNode(host, node, depth) {
    if (!node) return;
    if (node.type === "file") {
      appendFileRow(host, node.path, node.name, depth);
      return;
    }
    // Skip rendering the absolute root label; show children
    if (node.path === "/home/user" || node.path === "/") {
      (node.children || []).forEach(function (child) {
        renderTreeNode(host, child, depth);
      });
      return;
    }

    const key = node.path;
    const open =
      state.expanded[key] !== false &&
      (state.expanded[key] === true ||
        depth < 2 ||
        (state.activeProject &&
          key.indexOf("/home/user/projects/" + state.activeProject) === 0));

    const folder = document.createElement("div");
    folder.className = "ide-folder" + (open ? " open" : "");
    folder.style.setProperty("--ide-depth", String(depth));

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "ide-folder-toggle";
    toggle.setAttribute("data-path", node.path);
    toggle.title = "Right-click to export folder";
    toggle.innerHTML =
      '<span class="ide-chevron">' +
      (open ? "▾" : "▸") +
      "</span> " +
      (window.ChatreKit
        ? window.ChatreKit.iconHtml(open ? "folder-open" : "folder", 13) + " "
        : "") +
      '<span class="ide-name">' +
      escapeHtml(node.name) +
      "</span>";
    if (/^\/home\/user\/projects\/[^/]+$/.test(node.path)) {
      const slug = node.name;
      if (state.activeProject === slug) toggle.classList.add("is-active-project");
      toggle.addEventListener("dblclick", function (e) {
        e.preventDefault();
        setActiveProject(slug);
      });
    }
    toggle.addEventListener("click", function () {
      state.expanded[key] = !open;
      renderFileTree($("file-tree"), state.files);
    });
    toggle.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const projectMatch = String(node.path || "").match(
        /^\/home\/user\/projects\/([^/]+)$/,
      );
      openExplorerMenu(e.clientX, e.clientY, {
        kind: "dir",
        path: node.path,
        name: node.name,
        slug: projectMatch ? projectMatch[1] : null,
      });
    });
    folder.appendChild(toggle);

    if (open) {
      const kids = document.createElement("div");
      kids.className = "ide-folder-children";
      (node.children || []).forEach(function (child) {
        renderTreeNode(kids, child, depth + 1);
      });
      folder.appendChild(kids);
    }
    host.appendChild(folder);
  }

  function appendFileRow(host, path, name, depth) {
    const row = document.createElement("div");
    row.className =
      "file-item ide-file" + (state.selectedPath === path ? " active" : "");
    row.setAttribute("data-path", path);
    row.style.setProperty("--ide-depth", String(depth));
    const isAgents = /\/AGENTS\.md$/i.test(path);
    row.innerHTML =
      '<button type="button" class="file-open">' +
      (window.ChatreKit
        ? window.ChatreKit.iconHtml(isAgents ? "bot" : "file", 13) + " "
        : "") +
      escapeHtml(name || path) +
      (isAgents ? ' <span class="ide-badge">md</span>' : "") +
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
    row.querySelector(".file-open").addEventListener("click", function () {
      openFile(path);
    });
    row.querySelector(".file-ask").addEventListener("click", function () {
      askAboutFile(path);
    });
    row.querySelector(".file-diff").addEventListener("click", function () {
      showDiff(path);
    });
    row.querySelector(".file-dl").addEventListener("click", function () {
      downloadFile(path);
    });
    row.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      e.stopPropagation();
      openExplorerMenu(e.clientX, e.clientY, {
        kind: "file",
        path: path,
        name: name || path.split("/").pop(),
      });
    });
    host.appendChild(row);
  }

  async function setActiveProject(slug) {
    state.activeProject = slug;
    state.expanded["/home/user/projects/" + slug] = true;
    const wsId = remoteState().workspaceId || state.workspaceId;
    if (wsId && remote() && remote().setActiveProject) {
      try {
        await remote().setActiveProject(wsId, slug);
      } catch (e) {
        /* local fallback ok */
      }
    }
    if (window.ChatreKit && window.ChatreKit.toast) {
      window.ChatreKit.toast("Active project: " + slug, "success");
    }
    renderFileTree($("file-tree"), state.files);
  }

  function downloadFile(path) {
    const f = state.files[path];
    if (!f) return;
    const name = path.split("/").pop() || "file.txt";
    const mime =
      f.mime ||
      (/\.pdf$/i.test(path)
        ? "application/pdf"
        : /\.md$/i.test(path)
          ? "text/markdown"
          : "application/octet-stream");
    let blob;
    if (f.encoding === "base64" || (/\.pdf$/i.test(path) && /^[A-Za-z0-9+/=\s]+$/.test(String(f.content || "").slice(0, 80)))) {
      try {
        const bin = atob(String(f.content || "").replace(/\s+/g, ""));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        blob = new Blob([bytes], { type: mime });
      } catch (e) {
        blob = new Blob([f.content || ""], { type: "text/plain" });
      }
    } else {
      blob = new Blob([f.content || ""], { type: mime.indexOf("pdf") >= 0 ? "text/plain" : mime });
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function openFile(path) {
    state.selectedPath = path;
    ensureTab(path);
    renderFileTabs();
    syncActiveFileChip(path);
    const viewer = $("file-viewer");
    const meta = $("file-viewer-path");
    if (!viewer) return;
    let f = state.files[path];
    if (meta) meta.textContent = path;

    if (
      (!f || f.contentOmitted || f.content == null) &&
      remote() &&
      remote().enabled() &&
      remote().getFile
    ) {
      const wsId = remoteState().workspaceId || state.workspaceId;
      if (wsId) {
        try {
          const data = await remote().getFile(wsId, path);
          if (data && data.file) {
            f = data.file;
            state.files[path] = Object.assign({}, state.files[path] || {}, f);
          }
        } catch (e) {}
      }
    }

    if (state.viewerMode === "diff") {
      viewer.className = "file-viewer ide-diff-view";
      viewer.textContent = "Loading diff…";
      const wsId = remoteState().workspaceId || state.workspaceId;
      try {
        let unified = "";
        if (remote() && remote().getDiff && wsId) {
          const data = await remote().getDiff(wsId, path);
          unified =
            data.unified ||
            makeUnifiedDiff(data.previous || "", data.current || "", path);
        } else {
          const previous =
            (f && f.previousContent != null && f.previousContent) ||
            (state.fileSnapshots && state.fileSnapshots[path]) ||
            "";
          const current = f && f.content != null ? String(f.content) : "";
          unified = makeUnifiedDiff(previous, current, path);
        }
        viewer.innerHTML = renderDiffHtml(unified || "(empty diff)");
      } catch (e) {
        viewer.textContent = "Diff failed: " + (e.message || e);
      }
      if (window.ChatreUIAdv && window.ChatreUIAdv.pushArtifact) {
        window.ChatreUIAdv.pushArtifact({ kind: "file", title: path, path: path });
      }
      return;
    }

    const isPdf =
      /\.pdf$/i.test(path) || (f && f.mime === "application/pdf");
    if (isPdf && f && f.content != null) {
      viewer.className = "file-viewer";
      try {
        const bin = atob(String(f.content).replace(/\s+/g, ""));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(
          new Blob([bytes], { type: "application/pdf" }),
        );
        viewer.innerHTML =
          '<iframe title="PDF preview" src="' +
          url +
          '" style="width:100%;height:min(70vh,520px);border:0;border-radius:8px;background:#111"></iframe>' +
          '<p class="panel-empty" style="margin-top:0.5rem">PDF · ' +
          escapeHtml(path) +
          ' · <button type="button" class="btn file-dl-inline">Download</button></p>';
        const btn = viewer.querySelector(".file-dl-inline");
        if (btn) btn.addEventListener("click", () => downloadFile(path));
      } catch (e) {
        viewer.textContent =
          "Could not preview PDF. Use Download. (" + (e.message || e) + ")";
      }
      if (window.ChatreUIAdv && window.ChatreUIAdv.pushArtifact) {
        window.ChatreUIAdv.pushArtifact({ kind: "file", title: path, path: path });
      }
      return;
    }

    const content = f && f.content != null ? String(f.content) : "";
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
  }

  function askAboutFile(path) {
    const f = state.files[path];
    const snippet =
      f && f.content != null
        ? f.encoding === "base64"
          ? "(binary file)"
          : String(f.content).slice(0, 4000)
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
    return exportDirectoryZip("/home/user", {
      zipName: null,
      label: "workspace",
    });
  }

  function fileContentForZip(path, entry) {
    if (entry == null) return "";
    if (typeof entry === "string") return entry;
    const content = entry.content != null ? entry.content : "";
    if (
      entry.encoding === "base64" ||
      (/\.pdf$/i.test(path) &&
        /^[A-Za-z0-9+/=\s]+$/.test(String(content).slice(0, 80)))
    ) {
      try {
        const bin = atob(String(content).replace(/\s+/g, ""));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      } catch (e) {
        return String(content || "");
      }
    }
    return String(content || "");
  }

  async function collectExportFiles(dirPath) {
    const root = String(dirPath || "/home/user").replace(/\/$/, "") || "/home/user";
    const out = {};
    const take = function (p, contentOrEntry) {
      if (!p) return;
      if (root === "/home/user") {
        out[p] = contentOrEntry;
        return;
      }
      if (p === root || p.indexOf(root + "/") === 0) out[p] = contentOrEntry;
    };

    // Signed-in: ZIP from a single server snapshot revision only (no merge).
    const wsId = remoteState().workspaceId || state.workspaceId;
    if (remote() && remote().enabled() && wsId && remote().exportWorkspace) {
      const data = await remote().exportWorkspace(wsId);
      const files = (data && data.files) || {};
      Object.keys(files).forEach(function (p) {
        take(p, files[p]);
      });
      return {
        root: root,
        files: out,
        revision: data.revision != null ? data.revision : null,
        source: "server",
      };
    }

    Object.keys(state.files || {}).forEach(function (p) {
      const f = state.files[p];
      if (!f || f.type === "dir") return;
      take(p, f);
    });

    const localFs = (window.ChatreCore && window.ChatreCore.fs) || null;
    if (localFs) {
      Object.keys(localFs).forEach(function (p) {
        const f = localFs[p];
        if (!f || f.type === "dir") return;
        take(p, f);
      });
    }

    return { root: root, files: out, revision: state.revision || null, source: "local" };
  }

  async function exportDirectoryZip(dirPath, opts) {
    const o = opts || {};
    if (!window.JSZip) {
      alert("JSZip not loaded");
      return;
    }
    let collected;
    try {
      collected = await collectExportFiles(dirPath);
    } catch (e) {
      const msg = "Export failed: " + (e && e.message ? e.message : String(e));
      if (window.ChatreKit && window.ChatreKit.toast) {
        window.ChatreKit.toast(msg, "error");
      } else {
        alert(msg);
      }
      return;
    }
    const paths = Object.keys(collected.files).sort();
    if (!paths.length) {
      const msg =
        "No files to export under " + (collected.root || dirPath || "/");
      if (window.ChatreKit && window.ChatreKit.toast) {
        window.ChatreKit.toast(msg, "warn");
      } else {
        alert(msg);
      }
      return;
    }

    const zip = new JSZip();
    const root = collected.root;
    const folderName =
      o.folderName ||
      (root === "/home/user"
        ? "workspace"
        : root.split("/").filter(Boolean).pop() || "export");

    paths.forEach(function (p) {
      let rel;
      if (root === "/home/user") {
        rel = p.replace(/^\//, "") || "file.txt";
      } else if (p === root) {
        rel = folderName;
      } else {
        rel = folderName + "/" + p.slice(root.length + 1);
      }
      zip.file(rel, fileContentForZip(p, collected.files[p]));
    });

    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    const revSuffix =
      collected.revision != null ? "-r" + collected.revision : "";
    a.download =
      (o.zipName ||
        folderName.replace(/[^\w.\-]+/g, "_") ||
        "export") +
      revSuffix +
      "-" +
      stamp +
      ".zip";
    a.click();
    URL.revokeObjectURL(a.href);

    if (window.ChatreKit && window.ChatreKit.toast) {
      window.ChatreKit.toast(
        "Exported " +
          paths.length +
          " file(s) from " +
          (o.label || folderName) +
          (collected.revision != null ? " @ r" + collected.revision : ""),
        "success",
      );
    }
  }

  function ensureExplorerMenu() {
    let menu = document.getElementById("explorer-ctx-menu");
    if (menu) return menu;
    menu = document.createElement("div");
    menu.id = "explorer-ctx-menu";
    menu.className = "explorer-ctx-menu";
    menu.setAttribute("role", "menu");
    document.body.appendChild(menu);
    return menu;
  }

  function hideExplorerMenu() {
    const menu = document.getElementById("explorer-ctx-menu");
    if (!menu) return;
    menu.classList.remove("open");
    menu.innerHTML = "";
  }

  function openExplorerMenu(clientX, clientY, target) {
    const menu = ensureExplorerMenu();
    hideExplorerMenu();
    const t = target || {};
    const label = document.createElement("div");
    label.className = "ctx-label";
    label.textContent = t.name || t.path || "Item";
    menu.appendChild(label);

    function addItem(text, icon, action) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "menuitem");
      btn.innerHTML =
        (window.ChatreKit && icon
          ? window.ChatreKit.iconHtml(icon, 14) + " "
          : "") +
        escapeHtml(text);
      btn.addEventListener("click", function () {
        hideExplorerMenu();
        Promise.resolve()
          .then(action)
          .catch(function (err) {
            const msg = (err && err.message) || String(err);
            if (window.ChatreKit && window.ChatreKit.toast) {
              window.ChatreKit.toast(msg, "error");
            } else {
              alert(msg);
            }
          });
      });
      menu.appendChild(btn);
    }

    function addSep() {
      const sep = document.createElement("div");
      sep.className = "ctx-sep";
      menu.appendChild(sep);
    }

    if (t.kind === "file") {
      addItem("Download file", "download", function () {
        downloadFile(t.path);
      });
      addItem("Open", "file", function () {
        return openFile(t.path);
      });
      const parent = String(t.path || "").replace(/\/[^/]+$/, "") || "/home/user";
      addItem("Export parent folder…", "package", function () {
        return exportDirectoryZip(parent);
      });
    } else if (t.kind === "workspace") {
      addItem("Export entire workspace", "package", function () {
        return exportZip();
      });
    } else {
      addItem("Export folder as ZIP", "package", function () {
        return exportDirectoryZip(t.path || "/home/user", {
          label: t.name || t.path,
        });
      });
    }

    if (t.slug) {
      addSep();
      addItem("Set as active project", "folder-git-2", function () {
        return setActiveProject(t.slug);
      });
    }

    addSep();
    addItem("Copy path", "copy", async function () {
      const text = t.path || "";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      if (window.ChatreKit && window.ChatreKit.toast) {
        window.ChatreKit.toast("Copied path", "success");
      }
    });

    menu.classList.add("open");
    if (window.ChatreKit) window.ChatreKit.refreshIcons(menu);

    const pad = 8;
    const w = menu.offsetWidth || 200;
    const h = menu.offsetHeight || 160;
    let left = clientX;
    let top = clientY;
    if (left + w > window.innerWidth - pad) left = window.innerWidth - w - pad;
    if (top + h > window.innerHeight - pad) top = window.innerHeight - h - pad;
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    menu.style.left = left + "px";
    menu.style.top = top + "px";
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

  /**
   * Apply SSE file_event into the single client FS cache (explorer source of truth).
   */
  function applyFileEvent(ev) {
    if (!ev || ev.type !== "file_event") return;
    if (ev.revision != null) state.revision = ev.revision;
    const op = ev.op || "";
    if (op === "delete" && ev.path) {
      delete state.files[ev.path];
      const prefix = String(ev.path).endsWith("/")
        ? String(ev.path)
        : String(ev.path) + "/";
      Object.keys(state.files || {}).forEach(function (p) {
        if (p.indexOf(prefix) === 0) delete state.files[p];
      });
      const tree = $("file-tree");
      if (tree) renderFileTree(tree, state.files);
      return;
    }
    if (op === "put" && ev.file && ev.file.path) {
      const f = ev.file;
      const prev = state.files[f.path];
      if (f.contentOmitted && prev && prev.content != null) {
        state.files[f.path] = Object.assign({}, prev, f, {
          content: prev.content,
        });
      } else {
        state.files[f.path] = Object.assign({}, prev || {}, f, {
          path: f.path,
          type: f.type || "file",
        });
      }
      if (window.ChatreProjects) {
        state.projects = window.ChatreProjects.detectProjects(state.files);
      }
      const tree = $("file-tree");
      if (tree) renderFileTree(tree, state.files);
      return;
    }
    if (op === "sync") {
      (ev.deleted || []).forEach(function (p) {
        delete state.files[p];
      });
      // Full refresh for large syncs when changed set is big / content omitted
      if (!ev.changed || ev.changed.length > 20) {
        refreshFiles();
        return;
      }
      const tree = $("file-tree");
      if (tree) renderFileTree(tree, state.files);
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

    document.addEventListener("click", function (e) {
      const menu = document.getElementById("explorer-ctx-menu");
      if (!menu || !menu.classList.contains("open")) return;
      if (menu.contains(e.target)) return;
      hideExplorerMenu();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") hideExplorerMenu();
    });
    window.addEventListener("blur", hideExplorerMenu);
    document.addEventListener("scroll", hideExplorerMenu, true);

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
    refreshFiles();
    if (remote() && remote().enabled() && remote().hasAuth && remote().hasAuth()) {
      refreshThreads();
    }

    setInterval(refreshAuthStatus, 60000);
  }

  function openFilesPanel() {
    const shell = document.querySelector(".app-shell");
    if (!shell) return;
    const mobile =
      window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
    if (mobile) {
      shell.classList.remove("show-threads", "show-browser");
      shell.classList.add("show-files");
    } else {
      shell.classList.remove("hide-files");
    }
    refreshFiles();
  }

  window.ChatrePanels = {
    init,
    refreshAuthStatus,
    refreshThreads,
    refreshFiles,
    refreshRepoStatus,
    refreshDiagnostics,
    applyProblemsEvent,
    openFilesPanel,
    setActiveProject,
    updateUsageMeter,
    rememberWrite,
    applyFileEvent,
    setResumeAvailable,
    askAboutFile,
    togglePanel,
    setThreadsCollapsed,
    syncThreadsToggleUi,
    exportZip,
    exportDirectoryZip,
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
