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

  // ── Understanding strip ─────────────────────────────────────────────
  function showUnderstanding(briefing, record) {
    var b = briefing || (record && record.briefing) || {};
    var card = document.createElement("div");
    card.className = "understanding-strip";
    var goal = String(b.goal || b.understanding || "").trim();
    var kind = String(b.deliverable_kind || "").trim();
    var task = String(b.task_type || "").trim();
    var conf =
      b.confidence != null ? Math.round(Number(b.confidence) * 100) + "%" : "";
    var files = Array.isArray(b.files) ? b.files.filter(Boolean).slice(0, 2) : [];
    var bits = [];
    if (task) bits.push(task);
    if (kind) bits.push(kind);
    if (conf) bits.push(conf);
    card.innerHTML =
      '<div class="understanding-strip-main">' +
      '<span class="understanding-strip-label">Understood</span>' +
      '<span class="understanding-strip-goal">' +
      escapeHtml(goal || "Ready") +
      "</span>" +
      "</div>" +
      '<div class="understanding-strip-meta">' +
      escapeHtml(bits.join(" · ")) +
      (files.length
        ? " · <code>" + escapeHtml(String(files[0])) + "</code>"
        : "") +
      "</div>" +
      (b.intent_contract
        ? '<details class="understanding-strip-details"><summary>Intent</summary><pre>' +
          escapeHtml(b.intent_contract) +
          "</pre></details>"
        : "") +
      '<button type="button" class="understanding-strip-dismiss" aria-label="Dismiss">×</button>';
    card.querySelector(".understanding-strip-dismiss").addEventListener(
      "click",
      function () {
        clearSlot("understanding");
      },
    );
    window.__lastUnderstandingBriefing = b;
    return setSlot("understanding", card);
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
      window.__pendingClarification = false;
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
          if (send) send.click();
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
    window.__pendingClarification = true;
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
  function handoffProofToFiles(proof) {
    if (!proof) return;
    var paths = Array.isArray(proof.filesTouched)
      ? proof.filesTouched.filter(Boolean)
      : [];
    if (!paths.length && proof.activeProject) {
      paths = ["/home/user/projects/" + proof.activeProject + "/"];
    }
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
      if (paths[0] && window.ChatrePanels.highlightPath) {
        try {
          window.ChatrePanels.highlightPath(paths[0]);
        } catch (e2) {
          /* ignore */
        }
      }
    }
    if (paths.length) {
      var rail = $("artifact-rail");
      if (rail) {
        rail.hidden = false;
        rail.innerHTML =
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
      rail.querySelectorAll(".artifact-rail-item").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var p = btn.getAttribute("data-path");
            if (p && window.ChatrePanels && window.ChatrePanels.openFile) {
              window.ChatrePanels.openFile(p);
            }
          });
        });
      }
    }
  }

  function enhanceDoneProofCard(card, proof) {
    if (!card || !proof) return;
    var paths = Array.isArray(proof.filesTouched)
      ? proof.filesTouched.filter(Boolean)
      : [];
    if (!paths.length) return;
    var actions = document.createElement("div");
    actions.className = "done-proof-actions";
    actions.innerHTML =
      '<button type="button" class="btn done-proof-open-files">Open in Files</button>';
    actions.querySelector(".done-proof-open-files").addEventListener(
      "click",
      function () {
        handoffProofToFiles(proof);
      },
    );
    card.appendChild(actions);
    if (proof.ok && proof.taskType !== "chat" && proof.taskType !== "question") {
      handoffProofToFiles(proof);
    }
  }

  // ── Unified run status (hide legacy strip noise) ────────────────────
  function syncRunStatus(phaseText) {
    var strip = $("status-strip");
    if (strip) {
      strip.setAttribute("data-unified", "1");
      // Keep connection chips; collapse duplicate "working" noise via CSS.
    }
    var phase = $("composer-busy-phase");
    if (phase && phaseText) phase.textContent = phaseText;
    var run = $("composer-run");
    if (run) run.hidden = false;
  }

  function hideRunStatus() {
    var run = $("composer-run");
    if (run && !document.body.classList.contains("is-working")) {
      /* composer.js owns visibility */
    }
  }

  window.ChatreDeliveryUI = {
    showUnderstanding: showUnderstanding,
    showClarify: showClarify,
    showBanner: showBanner,
    refreshAuthBanner: refreshAuthBanner,
    clearSlot: clearSlot,
    handoffProofToFiles: handoffProofToFiles,
    enhanceDoneProofCard: enhanceDoneProofCard,
    syncRunStatus: syncRunStatus,
    hideRunStatus: hideRunStatus,
    ensureHost: ensureHost,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      ensureHost();
      refreshAuthBanner();
    });
  } else {
    ensureHost();
    refreshAuthBanner();
  }
})();
