/**
 * Chatre UI advancements — timeline, browser pane, status chips, budget bar, artifacts.
 */
(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  // ── Mode segmented control (legacy removed — composer owns modes) ───
  function initModeControl() {
    /* no-op */
  }

  function readCollapsed(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      if (v == null) return !!fallback;
      return v === "1";
    } catch (e) {
      return !!fallback;
    }
  }

  function writeCollapsed(key, collapsed) {
    try {
      localStorage.setItem(key, collapsed ? "1" : "0");
    } catch (e) {
      /* ignore */
    }
  }

  function applyCollapsed(host, collapsed) {
    if (!host) return;
    host.classList.toggle("is-collapsed", !!collapsed);
    const toggle = host.querySelector(".collapsible-rail-toggle");
    if (toggle) {
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      const tip = collapsed ? "Expand" : "Collapse";
      toggle.title = tip;
      toggle.setAttribute("data-tip", tip);
    }
  }

  function setCollapsibleMeta(host, text) {
    if (!host) return;
    const meta = host.querySelector(".collapsible-rail-meta");
    if (meta) meta.textContent = text || "";
  }

  /** Ensure a collapsible head + body shell; returns the body node. */
  function ensureCollapsibleShell(host, opts) {
    opts = opts || {};
    if (!host) return null;
    let body = null;
    for (let i = 0; i < host.children.length; i++) {
      if (host.children[i].classList.contains("collapsible-rail-body")) {
        body = host.children[i];
        break;
      }
    }
    if (host.dataset.collapsible === "1" && body) return body;

    const kids = Array.prototype.slice.call(host.childNodes);
    host.dataset.collapsible = "1";
    host.classList.add("collapsible-rail");

    const toggle = el("button", "collapsible-rail-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-controls", host.id || "");
    const chevron = el("span", "collapsible-rail-chevron");
    chevron.innerHTML =
      window.ChatreKit && window.ChatreKit.iconHtml
        ? window.ChatreKit.iconHtml("chevron-down", 14)
        : "▾";
    const label = el("span", "collapsible-rail-label");
    label.textContent = opts.label || "Section";
    const meta = el("span", "collapsible-rail-meta");
    toggle.appendChild(chevron);
    toggle.appendChild(label);
    toggle.appendChild(meta);

    body = el("div", "collapsible-rail-body");
    kids.forEach(function (n) {
      body.appendChild(n);
    });

    host.textContent = "";
    host.appendChild(toggle);
    host.appendChild(body);

    const storageKey = opts.storageKey || "";
    applyCollapsed(host, storageKey ? readCollapsed(storageKey, false) : false);
    toggle.addEventListener("click", function () {
      const next = !host.classList.contains("is-collapsed");
      applyCollapsed(host, next);
      if (storageKey) writeCollapsed(storageKey, next);
    });
    if (window.ChatreKit) window.ChatreKit.refreshIcons(toggle);
    return body;
  }

  function ensureArtifactRailBody() {
    const rail = $("artifact-rail");
    if (!rail) return null;
    const body = ensureCollapsibleShell(rail, {
      label: "Artifacts",
      storageKey: "chatre.artifactRailCollapsed",
    });
    setCollapsibleMeta(
      rail,
      artifactStore.length ? String(artifactStore.length) : "",
    );
    return body;
  }

  // ── Starter chips ───────────────────────────────────────────────────
  function initStarterChips() {
    const row = $("starter-chips");
    if (!row) return;
    const body = ensureCollapsibleShell(row, {
      label: "Starters",
      storageKey: "chatre.starterChipsCollapsed",
    });
    body.innerHTML = "";
    const starters = [
      {
        id: "calc",
        label: "HTML calculator",
        icon: "calculator",
        prompt:
          "Build a simple calculator as index.html in /home/user/projects/calculator/",
        mode: "agent",
      },
      {
        id: "pdf",
        label: "PDF report",
        icon: "file-text",
        prompt:
          "Create a short PDF report summarizing the current workspace and save it under /home/user/projects/",
        mode: "agent",
      },
      {
        id: "debug",
        label: "Debug this",
        icon: "bug",
        prompt: "Debug the issue in the active file and fix it with proof.",
        mode: "code",
      },
      {
        id: "explain",
        label: "Explain code",
        icon: "message-circle",
        prompt: "Explain how the active file works, step by step.",
        mode: "chat",
      },
    ];
    starters.forEach(function (s) {
      const b = el("button", "starter-chip");
      b.type = "button";
      if (window.ChatreKit && window.ChatreKit.labelWithIcon) {
        b.innerHTML = window.ChatreKit.labelWithIcon(s.icon, s.label, 14);
      } else {
        b.textContent = s.label;
      }
      b.setAttribute("data-tip", s.label);
      b.addEventListener("click", function () {
        const input = $("user-input");
        if (!input) return;
        if (s.mode && window.ChatreComposer && window.ChatreComposer.setMode) {
          window.ChatreComposer.setMode(s.mode);
        }
        input.value = s.prompt;
        input.focus();
        input.dispatchEvent(new Event("input"));
      });
      body.appendChild(b);
    });
    setCollapsibleMeta(row, String(starters.length));
    if (window.ChatreKit) {
      window.ChatreKit.refreshIcons(row);
      window.ChatreKit.bindTips(row);
    }
  }

  // ── Status action strip ─────────────────────────────────────────────
  function setStatusChip(id, kind, label, action) {
    const host = $("status-strip");
    if (!host) return;
    let chip = host.querySelector('[data-chip="' + id + '"]');
    if (!chip) {
      chip = el("button", "status-chip");
      chip.type = "button";
      chip.setAttribute("data-chip", id);
      host.appendChild(chip);
    }
    chip.className = "status-chip " + (kind || "off");
    const icons = {
      companion: "monitor",
      api: "key-round",
      login: "shield-alert",
    };
    if (window.ChatreKit && window.ChatreKit.labelWithIcon && label) {
      chip.innerHTML = window.ChatreKit.labelWithIcon(
        icons[id] || "info",
        label,
        14,
      );
      window.ChatreKit.refreshIcons(chip);
    } else {
      chip.textContent = label;
    }
    chip.onclick = typeof action === "function" ? action : null;
    chip.hidden = !label;
  }

  function refreshStatusActions() {
    // Connection / companion CTAs live on toolbar pills — keep status-strip
    // for ephemeral chips only (e.g. login pause).
    const companion = $("status-strip") &&
      $("status-strip").querySelector('[data-chip="companion"]');
    if (companion) companion.hidden = true;
    const api = $("status-strip") &&
      $("status-strip").querySelector('[data-chip="api"]');
    if (api) api.hidden = true;
  }

  // ── Budget bar ──────────────────────────────────────────────────────
  function updateBudgetBar(usage) {
    const bar = $("budget-bar");
    const fill = $("budget-bar-fill");
    const label = $("budget-bar-label");
    if (!bar || !fill) return;
    if (!usage || (usage.maxSteps == null && usage.remainingSteps == null)) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const max = Number(usage.maxSteps) ||
      (Number(usage.steps || 0) + Number(usage.remainingSteps || 0)) ||
      1;
    const used = Number(usage.steps || 0);
    const left = usage.remainingSteps != null
      ? Number(usage.remainingSteps)
      : Math.max(0, max - used);
    const pct = Math.max(0, Math.min(100, (used / max) * 100));
    fill.style.width = pct + "%";
    if (label) {
      label.textContent =
        "Steps " + used + "/" + max + " · " + left + " left" +
        (usage.elapsedMs != null
          ? " · " + Math.round(usage.elapsedMs / 1000) + "s"
          : "");
    }
  }

  // ── Browser live pane ───────────────────────────────────────────────
  function setBrowserPane(opts) {
    opts = opts || {};
    const pane = $("browser-panel") || $("browser-pane");
    const img = $("browser-pane-img");
    const meta = $("browser-pane-meta");
    const empty = $("browser-pane-empty");
    if (!pane) return;
    if (opts.open !== false && window.ChatrePanels && window.ChatrePanels.togglePanel) {
      const shell = document.querySelector(".app-shell");
      if (shell && shell.classList.contains("hide-browser")) {
        window.ChatrePanels.togglePanel("browser");
      }
    }
    if (opts.dataUrl && img) {
      img.src = opts.dataUrl;
      img.hidden = false;
      if (empty) empty.hidden = true;
      img.classList.remove("flash");
      void img.offsetWidth;
      img.classList.add("flash");
    }
    var displayUrl = String(opts.url || "").trim();
    var runUrl =
      String(opts.runUrl || "").trim() ||
      (window.ChatrePreview && window.ChatrePreview._activeRunUrl) ||
      "";
    var isLocal =
      window.ChatrePreview &&
      window.ChatrePreview.isLocalPreviewUrl &&
      window.ChatrePreview.isLocalPreviewUrl(displayUrl);

    function appendUrlLink(host) {
      if (!displayUrl) return;
      var a = document.createElement("a");
      a.className = "browser-pane-link";
      a.textContent = displayUrl;
      a.title = isLocal
        ? "Open runnable live preview"
        : "Open in browser";
      if (runUrl) {
        a.href = runUrl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      } else if (isLocal) {
        a.href = displayUrl;
        a.addEventListener("click", function (e) {
          e.preventDefault();
          if (window.ChatrePreview && window.ChatrePreview.openExternal) {
            window.ChatrePreview.openExternal();
          }
        });
      } else {
        a.href = displayUrl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
      host.appendChild(a);
    }

    if (meta) {
      meta.textContent = "";
      appendUrlLink(meta);
      if (opts.note) {
        meta.appendChild(
          document.createTextNode((displayUrl ? " · " : "") + opts.note),
        );
      }
      if (opts.login) {
        meta.appendChild(document.createTextNode(" · waiting for login"));
      }
    }
    var action = $("browser-pane-action");
    if (action && (opts.note || opts.login || displayUrl)) {
      action.hidden = false;
      action.textContent = "";
      if (opts.login) {
        action.appendChild(document.createTextNode("Login pause · "));
      }
      if (opts.note) {
        action.appendChild(document.createTextNode(opts.note));
      }
      if (displayUrl) {
        if (opts.note || opts.login) {
          action.appendChild(document.createTextNode(" · "));
        }
        appendUrlLink(action);
      }
      if (empty && !opts.dataUrl) empty.hidden = true;
    }
  }

  function showLoginPause(reason) {
    setBrowserPane({ note: reason || "Complete login / 2FA", login: true, open: true });
    setStatusChip("login", "warn", "Resume after login", function () {
      if (window.ChatreUI && window.ChatreUI.resumeAgent) {
        window.ChatreUI.resumeAgent();
      }
    });
  }

  function clearLoginChip() {
    const c = $("status-strip") &&
      $("status-strip").querySelector('[data-chip="login"]');
    if (c) c.hidden = true;
  }

  // ── Timeline ────────────────────────────────────────────────────────
  function createTimeline(host) {
    const root = el("div", "run-timeline");
    host.appendChild(root);
    const steps = [];

    function add(kind, title, detail, opts) {
      opts = opts || {};
      const item = el("div", "timeline-item timeline-" + kind + (opts.open ? " open" : ""));
      const head = el("button", "timeline-head");
      head.type = "button";
      head.innerHTML =
        '<span class="timeline-dot"></span><span class="timeline-title"></span>';
      head.querySelector(".timeline-title").textContent = title;
      const body = el("div", "timeline-body");
      if (detail) {
        if (typeof detail === "string") body.textContent = detail;
        else body.appendChild(detail);
      }
      if (!opts.open) body.hidden = true;
      head.addEventListener("click", function () {
        item.classList.toggle("open");
        body.hidden = !item.classList.contains("open");
      });
      item.appendChild(head);
      item.appendChild(body);
      root.appendChild(item);
      steps.push({ item: item, body: body, kind: kind });
      item.classList.add("enter");
      return { item: item, body: body };
    }

    function setPhase(kind, title) {
      add(kind, title, "", { open: false });
      if (window.ChatreMotion) window.ChatreMotion.onPhaseChange(title || kind);
    }

    return { root: root, add: add, setPhase: setPhase, steps: steps };
  }

  // ── Collapsible tool card ───────────────────────────────────────────
  function renderToolCard(call, timeline) {
    const detail = document.createElement("div");
    detail.className = "tool-call collapsed";
    detail.dataset.toolId = call.id || call.tool;
    const params = call.params || {};
    const summary =
      (window.ChatreUI && window.ChatreUI.formatToolParams
        ? window.ChatreUI.formatToolParams(call.tool, params)
        : JSON.stringify(params).slice(0, 120));
    detail.innerHTML =
      '<div class="tool-call-header">' +
      '<span class="tool-icon">' +
      (window.ChatreKit
        ? window.ChatreKit.iconHtml(toolIcon(call.tool), 14)
        : "⚒") +
      "</span>" +
      '<span class="tool-name"></span>' +
      '<span class="tool-status running">running…</span>' +
      "</div>" +
      '<div class="tool-call-detail"></div>' +
      '<div class="tool-call-result"></div>';
    detail.querySelector(".tool-name").textContent = call.tool;
    detail.querySelector(".tool-call-detail").textContent = summary;
    detail.addEventListener("click", function (e) {
      if (e.target.closest("a,button")) return;
      detail.classList.toggle("open");
      detail.classList.toggle("collapsed");
    });
    if (window.ChatreMotion) window.ChatreMotion.markToolRunning(detail);
    const slot = timeline
      ? timeline.add("tool", call.tool, detail, { open: false }).body
      : null;
    if (slot) {
      slot.appendChild(detail);
      if (window.ChatreKit) window.ChatreKit.refreshIcons(detail);
      return detail;
    }
    if (window.ChatreKit) window.ChatreKit.refreshIcons(detail);
    return detail;
  }

  function toolIcon(name) {
    const n = String(name || "");
    if (/navigate|browser|computer|screenshot|read_page|find|form/.test(n)) {
      return "globe";
    }
    if (/search/.test(n)) return "search";
    if (/desktop/.test(n)) return "monitor";
    if (/write|create_document|create_pdf|file/.test(n)) return "file-pen";
    if (/shell|terminal|run_command/.test(n)) return "terminal";
    if (/git|commit/.test(n)) return "git-branch";
    return "wrench";
  }

  function updateToolCard(card, result) {
    if (!card) return;
    const status = card.querySelector(".tool-status");
    const resultDiv = card.querySelector(".tool-call-result");
    if (result && result.ok === false) {
      status.textContent = "error";
      status.className = "tool-status error";
      resultDiv.className = "tool-call-result error";
      resultDiv.textContent = result.error || "failed";
      card.classList.add("open");
      card.classList.remove("collapsed");
      if (window.ChatreMotion) window.ChatreMotion.markToolDone(card, false);
    } else {
      status.textContent = "done";
      status.className = "tool-status done";
      const outText =
        (result &&
          (result.guide || result.text || result.output || result.content)) ||
        "ok";
      resultDiv.textContent =
        typeof outText === "string" && outText.length > 400
          ? outText.slice(0, 400) + "\n…(truncated)"
          : outText;
      if (window.ChatreMotion) window.ChatreMotion.markToolDone(card, true);
    }
    if (result && result.path && window.ChatreMotion) {
      window.ChatreMotion.flashPath(result.path);
    }
    if (result && (result.screenshot_ui || result.screenshot_preview)) {
      const dataUrl =
        result.screenshot_ui ||
        "data:image/jpeg;base64," + result.screenshot_preview;
      setBrowserPane({
        dataUrl: dataUrl,
        url: result.url || "",
        note: "screenshot",
        open: true,
      });
      if (window.ChatreUX && window.ChatreUX.setBrowserAction) {
        window.ChatreUX.setBrowserAction(
          "Screenshot captured",
          result.url || "",
        );
      }
      const thumb = document.createElement("img");
      thumb.className = "tool-shot-thumb";
      thumb.alt = "Browser screenshot";
      thumb.src = dataUrl;
      resultDiv.appendChild(thumb);
    }
    if (result && result.hasScreenshot && !result.screenshot_ui) {
      setBrowserPane({
        url: result.url || "",
        note: "screenshot captured",
        open: true,
      });
    }
  }

  // ── Artifacts ───────────────────────────────────────────────────────
  const artifactStore = [];

  function listArtifacts() {
    return artifactStore.slice();
  }

  function pushArtifact(item) {
    const rail = $("artifact-rail");
    if (!rail) return;
    const body = ensureArtifactRailBody();
    if (!body) return;
    const entry = {
      kind: item.kind || "file",
      title: item.title || item.path || item.kind || "Artifact",
      path: item.path || "",
      dataUrl: item.dataUrl || "",
      downloadUrl: item.downloadUrl || "",
      filename: item.filename || "",
    };
    artifactStore.unshift(entry);
    if (artifactStore.length > 40) artifactStore.length = 40;
    rail.hidden = false;
    setCollapsibleMeta(rail, String(artifactStore.length));
    const card = el("div", "artifact-card enter");
    const title = entry.title;
    card.innerHTML =
      '<div class="artifact-kind"></div><div class="artifact-title"></div><div class="artifact-actions"></div>';
    const kindIcon =
      item.kind === "upload"
        ? "upload"
        : item.kind === "document" || /create_document/.test(item.kind || "")
          ? "file-text"
          : "file";
    const kindEl = card.querySelector(".artifact-kind");
    if (window.ChatreKit) {
      kindEl.innerHTML =
        window.ChatreKit.iconHtml(kindIcon, 12) +
        " " +
        (item.kind || "file");
    } else {
      kindEl.textContent = item.kind || "file";
    }
    card.querySelector(".artifact-title").textContent = title;
    const actions = card.querySelector(".artifact-actions");
    if (item.dataUrl) {
      const a = el("a", "btn");
      a.innerHTML = window.ChatreKit
        ? window.ChatreKit.labelWithIcon("external-link", "Open", 13)
        : "Open";
      a.href = item.dataUrl;
      a.target = "_blank";
      a.rel = "noopener";
      actions.appendChild(a);
    }
    if (item.path && window.ChatreUI && window.ChatreUI.composeAndSend) {
      const b = el("button", "btn");
      b.type = "button";
      b.innerHTML = window.ChatreKit
        ? window.ChatreKit.labelWithIcon("message-circle", "Ask", 13)
        : "Ask";
      b.addEventListener("click", function () {
        window.ChatreUI.composeAndSend("Explain " + item.path);
      });
      actions.appendChild(b);
    }
    if (item.downloadUrl) {
      const a = el("a", "btn");
      a.innerHTML = window.ChatreKit
        ? window.ChatreKit.labelWithIcon("download", "Download", 13)
        : "Download";
      a.href = item.downloadUrl;
      a.download = item.filename || "download";
      actions.appendChild(a);
    }
    body.prepend(card);
    if (window.ChatreKit) window.ChatreKit.refreshIcons(card);
  }

  // ── Empty / first-run state ─────────────────────────────────────────
  function renderEmptyState(host) {
    if (!host) return;
    host.querySelectorAll(".empty-state").forEach(function (n) {
      n.remove();
    });
    const signed =
      window.ChatreAuth && window.ChatreAuth.isSignedIn();
    const box = el("div", "empty-state enter");
    box.innerHTML =
      '<div class="empty-icon">' +
      (window.ChatreKit ? window.ChatreKit.iconHtml("sparkles", 28) : "") +
      "</div>" +
      "<h2>What do you want built?</h2>" +
      "<p>" +
      (signed
        ? "Describe a deliverable. Chatre clarifies, plans, then ships files you can open."
        : "Sign in to sync threads and run the cloud agent — or try a local starter below.") +
      "</p>" +
      '<div class="empty-starters" aria-label="Starters"></div>' +
      '<div class="empty-actions"></div>';
    const startersHost = box.querySelector(".empty-starters");
    [
      {
        label: "HTML calculator",
        prompt:
          "Build a simple calculator as index.html in /home/user/projects/calculator/",
        mode: "agent",
      },
      {
        label: "PDF report",
        prompt:
          "Create a short PDF report summarizing the current workspace and save it under /home/user/projects/",
        mode: "agent",
      },
      {
        label: "Debug this",
        prompt: "Debug the issue in the active file and fix it with proof.",
        mode: "code",
      },
      {
        label: "Explain code",
        prompt: "Explain how the active file works, step by step.",
        mode: "chat",
      },
    ].forEach(function (s) {
      const chip = el("button", "starter-chip");
      chip.type = "button";
      chip.textContent = s.label;
      chip.addEventListener("click", function () {
        if (s.mode && window.ChatreComposer && window.ChatreComposer.setMode) {
          window.ChatreComposer.setMode(s.mode);
        }
        if (window.ChatreUI && window.ChatreUI.composeAndSend) {
          window.ChatreUI.composeAndSend(s.prompt);
        } else {
          const input = $("user-input");
          if (input) {
            input.value = s.prompt;
            input.focus();
            input.dispatchEvent(new Event("input"));
          }
        }
      });
      startersHost.appendChild(chip);
    });
    const actions = box.querySelector(".empty-actions");
    if (!signed) {
      const keyBtn = el("button", "btn");
      keyBtn.type = "button";
      keyBtn.innerHTML = window.ChatreKit
        ? window.ChatreKit.labelWithIcon("user", "Sign in", 14)
        : "Sign in";
      keyBtn.addEventListener("click", function () {
        if (window.ChatreUX && window.ChatreUX.openAuthGate) {
          window.ChatreUX.openAuthGate({ tab: "signin" });
        } else if (window.ChatreUX && window.ChatreUX.openSettings) {
          window.ChatreUX.openSettings();
        }
      });
      actions.appendChild(keyBtn);
    } else {
      const byokBtn = el("button", "btn");
      byokBtn.type = "button";
      byokBtn.innerHTML = window.ChatreKit
        ? window.ChatreKit.labelWithIcon("key-round", "BYOK settings", 14)
        : "BYOK settings";
      byokBtn.addEventListener("click", function () {
        if (window.ChatreUX && window.ChatreUX.openSettings) {
          window.ChatreUX.openSettings();
        }
        setTimeout(function () {
          const inp = $("byok-key");
          if (inp) inp.focus();
        }, 80);
      });
      actions.appendChild(byokBtn);
    }
    host.appendChild(box);
    if (window.ChatreKit) window.ChatreKit.refreshIcons(box);
  }

  function escapeEmpty(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function refreshEmptyState() {
    const host = $("chat-messages");
    if (!host) return;
    if (!host.querySelector(".empty-state")) return;
    if (host.querySelector(".message")) return;
    renderEmptyState(host);
  }

  // ── Plan drawer ─────────────────────────────────────────────────────
  function openPlanDrawer(briefing, onContinue, onCancel, opts) {
    const drawer = $("plan-drawer");
    const body = $("plan-drawer-body");
    const planOpts = opts || {
      planMarkdown: briefing && briefing.planMarkdown,
      planPath: briefing && briefing.planPath,
      planErrors: briefing && briefing.planErrors,
      planComplete: briefing && briefing.planComplete,
    };
    if (!drawer || !body || !window.ChatrePlanUI) {
      if (window.ChatrePlanUI) {
        return window.ChatrePlanUI.renderPlanCard(
          briefing,
          onContinue,
          onCancel,
          planOpts,
        );
      }
      return null;
    }
    body.innerHTML = "";
    const card = window.ChatrePlanUI.renderPlanCard(
      briefing,
      function (edited) {
        drawer.classList.remove("open");
        drawer.setAttribute("aria-hidden", "true");
        return onContinue && onContinue(edited);
      },
      function () {
        drawer.classList.remove("open");
        drawer.setAttribute("aria-hidden", "true");
        onCancel && onCancel();
      },
      planOpts,
    );
    body.appendChild(card);
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    if (window.ChatreMotion && window.ChatreMotion.animateIn) {
      window.ChatreMotion.animateIn(
        $("plan-drawer-panel") || drawer,
        "panel",
      );
    }
    return card;
  }

  function hideStarterChips() {
    const row = $("starter-chips");
    if (row) row.hidden = true;
  }

  function showStarterChips() {
    const row = $("starter-chips");
    if (!row) return;
    ensureCollapsibleShell(row, {
      label: "Starters",
      storageKey: "chatre.starterChipsCollapsed",
    });
    row.hidden = false;
  }

  function init() {
    initModeControl();
    initStarterChips();
    refreshStatusActions();
    setInterval(refreshStatusActions, 15000);
    const drawer = $("plan-drawer");
    if (drawer) {
      drawer.addEventListener("click", function (e) {
        if (e.target === drawer) {
          drawer.classList.remove("open");
          drawer.setAttribute("aria-hidden", "true");
        }
      });
    }
    if (window.ChatreAuth && window.ChatreAuth.onChange) {
      window.ChatreAuth.onChange(function () {
        refreshEmptyState();
      });
    }
  }

  window.ChatreUIAdv = {
    init: init,
    createTimeline: createTimeline,
    renderToolCard: renderToolCard,
    updateToolCard: updateToolCard,
    setBrowserPane: setBrowserPane,
    showLoginPause: showLoginPause,
    clearLoginChip: clearLoginChip,
    updateBudgetBar: updateBudgetBar,
    pushArtifact: pushArtifact,
    listArtifacts: listArtifacts,
    ensureArtifactRailBody: ensureArtifactRailBody,
    renderEmptyState: renderEmptyState,
    refreshEmptyState: refreshEmptyState,
    openPlanDrawer: openPlanDrawer,
    hideStarterChips: hideStarterChips,
    showStarterChips: showStarterChips,
    refreshStatusActions: refreshStatusActions,
    setStatusChip: setStatusChip,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
