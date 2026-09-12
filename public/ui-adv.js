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

  // ── Starter chips ───────────────────────────────────────────────────
  function initStarterChips() {
    const row = $("starter-chips");
    if (!row || !window.ChatrePlanTemplates) return;
    row.innerHTML = "";
    const starters = [
      { id: "research", label: "Research", icon: "search", prompt: "Research: " },
      { id: "fill-form", label: "Fill form", icon: "form-input", prompt: "Fill this form: " },
      { id: "build", label: "Build", icon: "hammer", prompt: "Build: " },
      { id: "ask", label: "Ask", icon: "message-circle", prompt: "" },
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
        if (s.id === "ask") {
          input.focus();
          return;
        }
        const seeded =
          window.ChatrePlanTemplates.briefingFromTemplate &&
          window.ChatrePlanTemplates.briefingFromTemplate(s.id, "");
        if (seeded) window.__pendingTemplateBriefing = seeded;
        input.value = s.prompt;
        input.focus();
        input.dispatchEvent(new Event("input"));
      });
      row.appendChild(b);
    });
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
    if (meta) {
      meta.textContent =
        (opts.url || "") +
        (opts.note ? " · " + opts.note : "") +
        (opts.login ? " · waiting for login" : "");
    }
    var action = $("browser-pane-action");
    if (action && (opts.note || opts.login)) {
      action.hidden = false;
      action.textContent =
        (opts.login ? "Login pause · " : "") +
        (opts.note || "") +
        (opts.url ? " · " + opts.url : "");
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
    rail.prepend(card);
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
    const profile =
      (window.ChatreAuth &&
        window.ChatreAuth.state &&
        window.ChatreAuth.state.profile) ||
      null;
    const role = (profile && profile.role) || (signed ? "user" : null);
    const email =
      (profile && profile.email) ||
      (window.ChatreAuth &&
        window.ChatreAuth.currentUser &&
        window.ChatreAuth.currentUser() &&
        window.ChatreAuth.currentUser().email) ||
      "";

    const box = el("div", "empty-state enter");
    if (signed) {
      box.innerHTML =
        '<div class="empty-icon">' +
        (window.ChatreKit ? window.ChatreKit.iconHtml("sparkles", 28) : "") +
        "</div>" +
        "<h2>Welcome back" +
        (email ? ", " + escapeEmpty(String(email).split("@")[0]) : "") +
        "</h2>" +
        "<p>You're signed in as a <strong>" +
        escapeEmpty(role || "user") +
        "</strong>. Threads and workspaces sync to your account. Chatre models stay the default.</p>" +
        '<ol class="empty-steps">' +
        "<li>Pick a mode in the composer (Agent / Browse / Code…)</li>" +
        "<li>Optional: add your own provider keys under Settings → BYOK</li>" +
        "<li>Optional: start the desktop companion for local tools</li>" +
        "<li>Try: <em>Open example.com and tell me the heading</em></li>" +
        "</ol>" +
        '<div class="empty-actions"></div>';
    } else {
      box.innerHTML =
        '<div class="empty-icon">' +
        (window.ChatreKit ? window.ChatreKit.iconHtml("sparkles", 28) : "") +
        "</div>" +
        "<h2>Chatre</h2>" +
        "<p>Sign in to sync threads and workspaces. The admin service key is not for chatting — it is RBAC admin-only (companion / ops).</p>" +
        '<ol class="empty-steps">' +
        "<li>Sign in with email or Google</li>" +
        "<li>Optional: add OpenRouter / Anthropic / OpenAI / Google keys under BYOK</li>" +
        "<li>Optional: run <code>npm run companion:start</code> for desktop tools</li>" +
        "<li>Try: <em>Open example.com and tell me the heading</em></li>" +
        "</ol>" +
        '<div class="empty-actions"></div>';
    }
    const actions = box.querySelector(".empty-actions");
    const tryBtn = el("button", "btn");
    tryBtn.type = "button";
    tryBtn.innerHTML = window.ChatreKit
      ? window.ChatreKit.labelWithIcon("play", "Try example.com", 14)
      : "Try example.com";
    tryBtn.addEventListener("click", function () {
      if (window.ChatreComposer && window.ChatreComposer.setMode) {
        window.ChatreComposer.setMode("browse");
      } else if (window.ChatreUI && window.ChatreUI.setAgentMode) {
        window.ChatreUI.setAgentMode(true);
      }
      if (window.ChatreUI && window.ChatreUI.composeAndSend) {
        window.ChatreUI.composeAndSend(
          "Open example.com and tell me the main heading",
        );
      }
    });
    actions.appendChild(tryBtn);
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
  function openPlanDrawer(briefing, onContinue, onCancel) {
    const drawer = $("plan-drawer");
    const body = $("plan-drawer-body");
    if (!drawer || !body || !window.ChatrePlanUI) {
      if (window.ChatrePlanUI) {
        return window.ChatrePlanUI.renderPlanCard(briefing, onContinue, onCancel);
      }
      return null;
    }
    body.innerHTML = "";
    const card = window.ChatrePlanUI.renderPlanCard(
      briefing,
      function (edited) {
        drawer.classList.remove("open");
        drawer.setAttribute("aria-hidden", "true");
        onContinue && onContinue(edited);
      },
      function () {
        drawer.classList.remove("open");
        drawer.setAttribute("aria-hidden", "true");
        onCancel && onCancel();
      },
    );
    body.appendChild(card);
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    return card;
  }

  function hideStarterChips() {
    const row = $("starter-chips");
    if (row) row.hidden = true;
  }

  function showStarterChips() {
    const row = $("starter-chips");
    if (row) row.hidden = false;
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
