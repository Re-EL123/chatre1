/**
 * Delivery UX — understanding strip, clarify card, proof→files, system banners.
 * Keeps agentic chat focused on understand → clarify → approve → deliver.
 */
(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ensureHost() {
    var wrap = $("message-input-wrap") || document.querySelector(".message-input-wrap");
    if (!wrap) return null;
    var host = $("delivery-ui-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "delivery-ui-host";
      host.className = "delivery-ui-host";
      wrap.insertBefore(host, wrap.firstChild);
    }
    return host;
  }

  function clearSlot(name) {
    var host = $("delivery-ui-host");
    if (!host) return;
    var el = host.querySelector('[data-slot="' + name + '"]');
    if (el) el.remove();
  }

  function setSlot(name, node) {
    var host = ensureHost();
    if (!host || !node) return null;
    clearSlot(name);
    node.setAttribute("data-slot", name);
    host.appendChild(node);
    return node;
  }

  function syncClarifySendState(pending) {
    window.__pendingClarification = !!pending;
    document.body.classList.toggle("awaiting-clarify", !!pending);
    var send = $("send-button");
    if (!send) return;
    if (pending) {
      send.disabled = true;
      send.textContent = "Answer first";
      send.setAttribute("data-primary", "clarify");
      send.classList.add("is-clarify-blocked");
    } else {
      send.classList.remove("is-clarify-blocked");
      if (window.ChatreComposer && window.ChatreComposer.paintPrimaryButton) {
        window.ChatreComposer.paintPrimaryButton();
      } else {
        send.disabled = false;
        send.textContent = "Send";
        send.setAttribute("data-primary", "send");
      }
    }
  }

  // ── Understanding strip ─────────────────────────────────────────────
  var _understandingTimer = null;
  var _lastUnderstandingKey = "";

  function shouldShowUnderstanding(briefing, record) {
    var b = briefing || (record && record.briefing) || {};
    var task = String(b.task_type || "").toLowerCase();
    var kind = String(b.deliverable_kind || "").toLowerCase();
    var goal = String(b.goal || b.understanding || "").trim();
    if (!goal) return false;
    // Light chat / Q&A — strip is noise, not signal.
    if (task === "chat" || task === "question") return false;
    if (kind === "answer" || kind === "chat") return false;
    if (goal.length < 8 && (task === "mixed" || !task)) return false;
    return true;
  }

  function showUnderstanding(briefing, record) {
    var b = briefing || (record && record.briefing) || {};
    if (!shouldShowUnderstanding(b, record)) {
      clearSlot("understanding");
      return null;
    }
    var goal = String(b.goal || b.understanding || "").trim();
    var task = String(b.task_type || "").trim();
    var kind = String(b.deliverable_kind || "").trim();
    var key = task + "|" + kind + "|" + goal.slice(0, 120);
    // Same understanding already visible — don't rebuild / re-animate.
    if (key && key === _lastUnderstandingKey) {
      var existing = document.querySelector(
        '#delivery-ui-host [data-slot="understanding"]',
      );
      if (existing) return existing;
    }
    _lastUnderstandingKey = key;

    var card = document.createElement("div");
    card.className = "understanding-strip";
    var conf =
      b.confidence != null ? Math.round(Number(b.confidence) * 100) + "%" : "";
    var bits = [];
    if (task) bits.push(task);
    if (kind) bits.push(kind);
    if (conf) bits.push(conf);
    card.innerHTML =
      '<div class="understanding-strip-main">' +
      '<span class="understanding-strip-label">Understood</span>' +
      '<span class="understanding-strip-goal">' +
      escapeHtml(goal.slice(0, 140)) +
      "</span>" +
      "</div>" +
      (bits.length
        ? '<div class="understanding-strip-meta">' +
          escapeHtml(bits.join(" · ")) +
          "</div>"
        : "") +
      '<button type="button" class="understanding-strip-dismiss" aria-label="Dismiss">×</button>';
    card.querySelector(".understanding-strip-dismiss").addEventListener(
      "click",
      function () {
        clearSlot("understanding");
        _lastUnderstandingKey = "";
        if (_understandingTimer) {
          clearTimeout(_understandingTimer);
          _understandingTimer = null;
        }
      },
    );
    window.__lastUnderstandingBriefing = b;
    var node = setSlot("understanding", card);
    if (_understandingTimer) clearTimeout(_understandingTimer);
    // Auto-dismiss so the composer doesn't stay filled with chrome.
    _understandingTimer = setTimeout(function () {
      clearSlot("understanding");
      _lastUnderstandingKey = "";
      _understandingTimer = null;
    }, 4500);
    return node;
  }

  function clearUnderstanding() {
    if (_understandingTimer) {
      clearTimeout(_understandingTimer);
      _understandingTimer = null;
    }
    _lastUnderstandingKey = "";
    clearSlot("understanding");
  }

  // ── Clarify card ────────────────────────────────────────────────────
  function showClarify(question, options, onContinue) {
    var q = String(question || "").trim();
    if (!q) return null;
    var card = document.createElement("div");
    card.className = "clarify-card";
    var opts = Array.isArray(options) ? options.filter(Boolean).slice(0, 6) : [];
    card.innerHTML =
      '<div class="clarify-card-head">Need one detail</div>' +
      '<p class="clarify-card-q">' +
      escapeHtml(q) +
      "</p>" +
      (opts.length
        ? '<div class="clarify-card-options">' +
          opts
            .map(function (o, i) {
              return (
                '<button type="button" class="btn clarify-opt" data-i="' +
                i +
                '">' +
                escapeHtml(String(o.label || o.text || o)) +
                "</button>"
              );
            })
            .join("") +
          "</div>"
        : "") +
      '<div class="clarify-card-row">' +
      '<input type="text" class="clarify-card-input" placeholder="Type your answer…" />' +
      '<button type="button" class="btn clarify-card-go">Continue</button>' +
      "</div>";

    function submit(text) {
      var t = String(text || "").trim();
      if (!t) return;
      clearSlot("clarify");
      // Keep resume flags until sendMessage consumes them.
      window.__pendingClarification = true;
      window.__pendingUserInput = { kind: "clarify", text: t };
      syncClarifySendState(false);
      if (typeof onContinue === "function") {
        onContinue(t);
        return;
      }
      if (window.ChatreUI && window.ChatreUI.composeAndSend) {
        window.ChatreUI.composeAndSend(t);
      } else {
        var input = $("user-input");
        if (input) {
          input.value = t;
          input.dispatchEvent(new Event("input"));
          var send = $("send-button");
          if (send) {
            send.disabled = false;
            send.click();
          }
        }
      }
    }

    card.querySelectorAll(".clarify-opt").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var i = Number(btn.getAttribute("data-i"));
        var o = opts[i];
        submit(o && (o.value || o.label || o.text || o));
      });
    });
    var input = card.querySelector(".clarify-card-input");
    var go = card.querySelector(".clarify-card-go");
    go.addEventListener("click", function () {
      submit(input.value);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        submit(input.value);
      }
    });
    syncClarifySendState(true);
    setTimeout(function () {
      input.focus();
    }, 30);
    return setSlot("clarify", card);
  }

  // ── System / quota / auth banner ────────────────────────────────────
  function showBanner(opts) {
    var o = opts || {};
    var kind = o.kind || "info";
    var text = String(o.text || "").trim();
    if (!text) {
      clearSlot("banner");
      return null;
    }
    var card = document.createElement("div");
    card.className = "delivery-banner delivery-banner-" + kind;
    card.innerHTML =
      '<span class="delivery-banner-text">' +
      escapeHtml(text) +
      "</span>" +
      (o.actionLabel
        ? '<button type="button" class="btn delivery-banner-action">' +
          escapeHtml(o.actionLabel) +
          "</button>"
        : "") +
      '<button type="button" class="delivery-banner-x" aria-label="Dismiss">×</button>';
    card.querySelector(".delivery-banner-x").addEventListener("click", function () {
      clearSlot("banner");
    });
    var act = card.querySelector(".delivery-banner-action");
    if (act && typeof o.onAction === "function") {
      act.addEventListener("click", function () {
        o.onAction();
      });
    }
    return setSlot("banner", card);
  }

  function showInterruptBanner(opts) {
    var o = opts || {};
    return showBanner({
      kind: o.kind || "warn",
      text: o.text,
      actionLabel: o.actionLabel,
      onAction: o.onAction,
    });
  }

  function refreshAuthBanner() {
    var signed =
      window.ChatreAuth &&
      window.ChatreAuth.isSignedIn &&
      window.ChatreAuth.isSignedIn();
    var base =
      window.CHATRE_API_BASE || localStorage.getItem("chatre_api_base") || "";
    if (base && !signed) {
      showBanner({
        kind: "warn",
        text: "Sign in to sync threads, run the cloud agent, and use BYOK models.",
        actionLabel: "Sign in",
        onAction: function () {
          if (window.ChatreUX && window.ChatreUX.openAuthGate) {
            window.ChatreUX.openAuthGate({ tab: "signin" });
          }
        },
      });
      return;
    }
    var modelSel = $("model-select");
    var model = modelSel && modelSel.value ? String(modelSel.value) : "";
    var isWorkers =
      !model || model.indexOf("@cf/") === 0 || /^chatre:/i.test(model);
    if (signed && isWorkers) {
      showBanner({
        kind: "info",
        text: "Using Workers AI — free daily quota may run out. Prefer a BYOK model in Settings for reliable runs.",
        actionLabel: "BYOK",
        onAction: function () {
          if (window.ChatreUX && window.ChatreUX.openSettings) {
            window.ChatreUX.openSettings();
          }
        },
      });
      return;
    }
    clearSlot("banner");
  }

  // ── Proof → Files ───────────────────────────────────────────────────
  function proofPaths(proof) {
    if (!proof) return [];
    var paths = Array.isArray(proof.filesTouched)
      ? proof.filesTouched.filter(Boolean)
      : [];
    if (!paths.length && proof.activeProject) {
      paths = ["/home/user/projects/" + proof.activeProject + "/"];
    }
    return paths;
  }

  function handoffProofToFiles(proof) {
    if (!proof) return;
    var paths = proofPaths(proof);
    if (window.ChatrePanels) {
      if (window.ChatrePanels.showFilesPanel) {
        window.ChatrePanels.showFilesPanel();
      } else if (window.ChatrePanels.togglePanel) {
        window.ChatrePanels.togglePanel("files", true);
      }
      if (paths[0] && window.ChatrePanels.openFile) {
        try {
          window.ChatrePanels.openFile(paths[0]);
        } catch (e) {
          /* ignore */
        }
      }
      paths.forEach(function (p) {
        if (p && window.ChatrePanels.highlightPath) {
          try {
            window.ChatrePanels.highlightPath(p);
          } catch (e2) {
            /* ignore */
          }
        }
      });
    }
    if (paths.length) {
      var rail = $("artifact-rail");
      if (rail) {
        var body = rail;
        if (
          window.ChatreUIAdv &&
          typeof window.ChatreUIAdv.ensureArtifactRailBody === "function"
        ) {
          body = window.ChatreUIAdv.ensureArtifactRailBody() || rail;
        } else {
          body = rail.querySelector(".collapsible-rail-body") || rail;
        }
        rail.hidden = false;
        body.innerHTML =
          '<div class="artifact-rail-title">Delivered</div>' +
          paths
            .slice(0, 6)
            .map(function (p) {
              return (
                '<button type="button" class="artifact-rail-item" data-path="' +
                escapeHtml(p) +
                '"><code>' +
                escapeHtml(p) +
                "</code></button>"
              );
            })
            .join("");
        body.querySelectorAll(".artifact-rail-item").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var p = btn.getAttribute("data-path");
            if (p && window.ChatrePanels && window.ChatrePanels.openFile) {
              window.ChatrePanels.openFile(p);
            }
          });
        });
        var meta = rail.querySelector(".collapsible-rail-meta");
        if (meta) meta.textContent = String(Math.min(paths.length, 6));
      }
    }
  }

  function enhanceDoneProofCard(card, proof, kind) {
    if (!card || !proof) return;
    var outcome =
      kind ||
      proof.outcomeKind ||
      (proof.ok ? "delivered" : "blocked");
    var paths = proofPaths(proof);
    var actions = document.createElement("div");
    actions.className = "done-proof-actions";
    var buttons = [];

    if (paths.length && outcome !== "chat-only") {
      buttons.push(
        '<button type="button" class="btn done-proof-open-files">Open in Files</button>',
      );
    }
    if (outcome === "blocked" || outcome === "partial") {
      buttons.push(
        '<button type="button" class="btn done-proof-retry">Retry</button>',
      );
      buttons.push(
        '<button type="button" class="btn done-proof-resume">Resume</button>',
      );
    }
    if (outcome === "blocked") {
      buttons.push(
        '<button type="button" class="btn done-proof-switch-model">Switch model</button>',
      );
    }
    if (!buttons.length) return;
    actions.innerHTML = buttons.join("");

    var openBtn = actions.querySelector(".done-proof-open-files");
    if (openBtn) {
      openBtn.addEventListener("click", function () {
        handoffProofToFiles(proof);
      });
    }
    var retryBtn = actions.querySelector(".done-proof-retry");
    if (retryBtn) {
      retryBtn.addEventListener("click", function () {
        if (window.ChatreUI && window.ChatreUI.composeAndSend) {
          window.ChatreUI.composeAndSend(
            "Retry the last task and finish a complete delivery with proof.",
          );
        }
      });
    }
    var resumeBtn = actions.querySelector(".done-proof-resume");
    if (resumeBtn) {
      resumeBtn.addEventListener("click", function () {
        var send = $("send-button");
        if (send && send.classList.contains("is-resume")) {
          send.click();
          return;
        }
        if (window.ChatreUI && window.ChatreUI.composeAndSend) {
          window.ChatreUI.composeAndSend(
            "Continue from where you stopped and finish delivery.",
          );
        }
      });
    }
    var modelBtn = actions.querySelector(".done-proof-switch-model");
    if (modelBtn) {
      modelBtn.addEventListener("click", function () {
        if (window.ChatreUX && window.ChatreUX.openSettings) {
          window.ChatreUX.openSettings();
        }
        setTimeout(function () {
          var sel = $("model-select");
          if (sel) sel.focus();
        }, 80);
      });
    }

    card.appendChild(actions);
    if (
      (outcome === "delivered" || outcome === "partial") &&
      proof.taskType !== "chat" &&
      proof.taskType !== "question" &&
      paths.length
    ) {
      handoffProofToFiles(proof);
    }
  }

  // ── Unified run status (hide legacy strip noise) ────────────────────
  function ensureRunActions() {
    var run = $("composer-run");
    if (!run) return null;
    var actions = $("composer-run-actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.id = "composer-run-actions";
      actions.className = "composer-run-actions";
      actions.innerHTML =
        '<button type="button" class="btn composer-run-stop" id="composer-run-stop" hidden>Stop</button>' +
        '<button type="button" class="btn composer-run-resume" id="composer-run-resume" hidden>Resume</button>';
      run.appendChild(actions);
      var stop = actions.querySelector("#composer-run-stop");
      var resume = actions.querySelector("#composer-run-resume");
      if (stop) {
        stop.addEventListener("click", function () {
          var main = $("stop-button");
          if (main) main.click();
        });
      }
      if (resume) {
        resume.addEventListener("click", function () {
          var send = $("send-button");
          if (send && send.classList.contains("is-resume")) send.click();
          else if (window.ChatreUI && window.ChatreUI.composeAndSend) {
            window.ChatreUI.composeAndSend("Resume the interrupted agent run.");
          }
        });
      }
    }
    return actions;
  }

  function syncRunStatus(phaseText, meta) {
    var strip = $("status-strip");
    if (strip) {
      strip.setAttribute("data-unified", "1");
      strip.hidden = true;
    }
    var budget = $("budget-bar");
    if (budget) budget.hidden = true;
    var phase = $("composer-busy-phase");
    if (phase && phaseText) phase.textContent = phaseText;
    var run = $("composer-run");
    if (run) run.hidden = false;
    ensureRunActions();
    var stop = $("composer-run-stop");
    var resume = $("composer-run-resume");
    var busy = document.body.classList.contains("is-working") ||
      document.body.classList.contains("is-composer-busy");
    var canResume =
      window.ChatrePanels &&
      window.ChatrePanels.state &&
      window.ChatrePanels.state.canResume;
    if (stop) stop.hidden = !busy;
    if (resume) resume.hidden = !(!busy && canResume);
    if (meta && meta.tool && $("composer-busy-tool")) {
      $("composer-busy-tool").textContent = "· " + meta.tool;
    }
    if (meta && meta.budget && $("composer-run-budget")) {
      $("composer-run-budget").textContent = meta.budget;
    }
  }

  function hideRunStatus() {
    var run = $("composer-run");
    if (run && !document.body.classList.contains("is-working")) {
      /* composer.js owns visibility */
    }
    var stop = $("composer-run-stop");
    if (stop) stop.hidden = true;
  }

  window.ChatreDeliveryUI = {
    showUnderstanding: showUnderstanding,
    clearUnderstanding: clearUnderstanding,
    showClarify: showClarify,
    showBanner: showBanner,
    showInterruptBanner: showInterruptBanner,
    refreshAuthBanner: refreshAuthBanner,
    clearSlot: clearSlot,
    handoffProofToFiles: handoffProofToFiles,
    enhanceDoneProofCard: enhanceDoneProofCard,
    syncRunStatus: syncRunStatus,
    hideRunStatus: hideRunStatus,
    ensureHost: ensureHost,
    syncClarifySendState: syncClarifySendState,
    ensureRunActions: ensureRunActions,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      ensureHost();
      ensureRunActions();
      refreshAuthBanner();
    });
  } else {
    ensureHost();
    ensureRunActions();
    refreshAuthBanner();
  }
})();
