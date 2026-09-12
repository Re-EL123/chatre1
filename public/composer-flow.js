/**
 * Chatre composer flow — /plan mode, status stack, micro-action pills
 * (Hermes-inspired run control above the input).
 */
(function () {
  "use strict";

  var status = {
    phase: "",
    tool: "",
    filesTouched: [],
    delivery: null, // true | false | null
    running: false,
  };

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

  function isPlanMode() {
    return !!(
      window.ChatreComposer &&
      window.ChatreComposer.getMode &&
      window.ChatreComposer.getMode() === "plan"
    );
  }

  function buildPlanPrompt(task) {
    var t = String(task || "").trim();
    return (
      "[/plan — plan mode]\n\n" +
      "For this turn you are in PLAN MODE — planning only.\n" +
      "- Do not implement code or create the final app/docs yet.\n" +
      "- Do not run mutating commands except writing the plan file itself.\n" +
      "- You may inspect the workspace with read-only tools (view_tree, read_file, list_directory).\n" +
      "- Save a markdown plan with write_file to /home/user/documents/plans/YYYY-MM-DD-<slug>.md " +
      "(create the plans directory if needed).\n" +
      "- Structure: Goal, Approach, Step-by-step tasks (exact paths), Validation, Risks/open questions.\n" +
      "- After saving, reply briefly with the plan path and stop. Do not start executing.\n\n" +
      (t
        ? "Task to plan:\n" + t
        : "Infer the task from conversation context. If unclear, ask one short clarifying question.")
    );
  }

  function wrapPlanMessage(message) {
    var text = String(message || "").trim();
    if (/^\[\/plan/i.test(text)) return text;
    return buildPlanPrompt(text);
  }

  function updateStatusStack( partial) {
    if (partial) Object.assign(status, partial);
    var host = $("composer-status-stack");
    var run = $("composer-run");
    if (!host) return;

    var phase = status.phase || (status.running ? "Working…" : "");
    var tool = status.tool || "";
    var files = status.filesTouched || [];
    var delivery = status.delivery;

    var bits = [];
    if (phase) {
      bits.push(
        '<span class="composer-status-pill" data-k="phase">' +
          escapeHtml(String(phase).slice(0, 48)) +
          "</span>",
      );
    }
    if (tool) {
      bits.push(
        '<span class="composer-status-pill" data-k="tool">' +
          escapeHtml(String(tool).slice(0, 40)) +
          "</span>",
      );
    }
    if (files.length) {
      bits.push(
        '<span class="composer-status-pill" data-k="files" title="' +
          escapeHtml(files.slice(-6).join("\n")) +
          '">' +
          files.length +
          " file" +
          (files.length === 1 ? "" : "s") +
          "</span>",
      );
    }
    if (delivery === true) {
      bits.push(
        '<span class="composer-status-pill ok" data-k="delivery">delivered</span>',
      );
    } else if (delivery === false && (status.running || files.length || phase)) {
      bits.push(
        '<span class="composer-status-pill warn" data-k="delivery">no delivery</span>',
      );
    }

    host.innerHTML = bits.join("");
    host.hidden = !bits.length;
    if (run && bits.length) run.hidden = false;
    if (window.ChatreMotion && bits.length) {
      window.ChatreMotion.staggerChildren(host, "pill", 35);
    }

    // Keep legacy phase/tool spans in sync when present
    if ($("composer-busy-phase") && phase) {
      $("composer-busy-phase").textContent = phase;
    }
    if ($("composer-busy-tool")) {
      $("composer-busy-tool").textContent = tool ? "· " + tool : "";
    }
  }

  function noteToolResult(tool, result) {
    var path =
      (result && (result.path || (result.artifact && result.path))) || null;
    if (
      path &&
      /^(write_file|append_file|create_document|create_pdf|patch_file|apply_patch|upload_artifact|image_generate|text_to_speech)$/.test(
        String(tool || ""),
      )
    ) {
      if (status.filesTouched.indexOf(path) < 0) {
        status.filesTouched = status.filesTouched.concat([path]);
      }
      status.delivery = true;
    }
    if (result && result.ok === false && !status.delivery) {
      /* keep prior */
    }
    updateStatusStack({ tool: tool || status.tool });
  }

  function noteDiagnostics(d) {
    if (!d) return;
    if (Array.isArray(d.filesTouched) && d.filesTouched.length) {
      status.filesTouched = d.filesTouched.slice();
    }
    if (typeof d.deliverySuccess === "boolean") {
      status.delivery = d.deliverySuccess;
    }
    updateStatusStack({});
    paintMicroActions();
  }

  function resetStatus() {
    status = {
      phase: "",
      tool: "",
      filesTouched: [],
      delivery: null,
      running: false,
    };
    updateStatusStack({});
  }

  function microActions() {
    var actions = [];
    var canResume =
      window.ChatrePanels &&
      window.ChatrePanels.state &&
      window.ChatrePanels.state.canResume;
    var resumeReason =
      (window.ChatrePanels &&
        window.ChatrePanels.state &&
        window.ChatrePanels.state.resumeReason) ||
      "";

    if (window.__pendingPlan && window.__pendingPlan.briefing) {
      actions.push({
        id: "approve-plan",
        label: "Approve plan",
        icon: "check",
        run: function () {
          if (window.ChatreUI && window.ChatreUI.resumeAgent) {
            window.ChatreUI.resumeAgent();
          }
        },
      });
    }

    if (window.__pendingExecutePlan) {
      actions.push({
        id: "execute-plan",
        label: "Approve & execute",
        icon: "play",
        run: function () {
          executeApprovedPlan();
        },
      });
    }

    if (canResume && !window.__pendingPlan) {
      var resumeLabel = "Resume";
      if (/login/i.test(resumeReason)) resumeLabel = "Resume after login";
      else if (/clarify|choice/i.test(resumeReason)) resumeLabel = "Continue";
      else if (/shell/i.test(resumeReason)) resumeLabel = "Resume shell";
      else if (/approv/i.test(resumeReason)) resumeLabel = "Approve & continue";
      actions.push({
        id: "resume",
        label: resumeLabel,
        icon: "play",
        run: function () {
          if (window.ChatreUI && window.ChatreUI.resumeAgent) {
            window.ChatreUI.resumeAgent();
          }
        },
      });
    }

    if (status.filesTouched && status.filesTouched.length) {
      actions.push({
        id: "open-files",
        label: "Open Files",
        icon: "folder",
        run: function () {
          if (window.ChatrePanels && window.ChatrePanels.openFilesPanel) {
            window.ChatrePanels.openFilesPanel();
          } else if (window.ChatrePanels && window.ChatrePanels.togglePanel) {
            window.ChatrePanels.togglePanel("files");
            if (window.ChatrePanels.refreshFiles) {
              window.ChatrePanels.refreshFiles();
            }
          }
        },
      });
    }

    if (status.delivery === false && !status.running) {
      actions.push({
        id: "retry-delivery",
        label: "Retry write",
        icon: "refresh",
        run: function () {
          if (window.ChatreUI && window.ChatreUI.composeAndSend) {
            window.ChatreUI.composeAndSend(
              "Retry delivery: call write_file now with FULL file contents under /home/user/projects/<slug>/. Do not narrate — only tools.",
            );
          }
        },
      });
    }

    if (window.__pendingUserInput && window.__pendingUserInput.options) {
      actions.push({
        id: "focus-choice",
        label: "Answer choices",
        icon: "list",
        run: function () {
          var el = document.querySelector(".ask-user-prompt, .option-buttons");
          if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" });
          var input = $("user-input");
          if (input) input.focus();
        },
      });
    }

    return actions;
  }

  function paintMicroActions() {
    var host = $("composer-micro-actions");
    if (!host) return;
    var actions = microActions();
    if (!actions.length) {
      host.hidden = true;
      host.innerHTML = "";
      return;
    }
    host.hidden = false;
    host.innerHTML = actions
      .map(function (a) {
        return (
          '<button type="button" class="composer-micro-pill" data-micro="' +
          escapeHtml(a.id) +
          '">' +
          (a.icon
            ? '<i data-lucide="' + escapeHtml(a.icon) + '"></i> '
            : "") +
          escapeHtml(a.label) +
          "</button>"
        );
      })
      .join("");
    if (window.ChatreKit && window.ChatreKit.refreshIcons) {
      window.ChatreKit.refreshIcons(host);
    }
    if (window.ChatreMotion) {
      window.ChatreMotion.staggerChildren(host, "pill", 45);
    }
  }

  function onMicroClick(e) {
    var btn = e.target.closest("[data-micro]");
    if (!btn) return;
    var id = btn.getAttribute("data-micro");
    var actions = microActions();
    for (var i = 0; i < actions.length; i++) {
      if (actions[i].id === id) {
        actions[i].run();
        return;
      }
    }
  }

  function slugFromText(text) {
    return (
      String(text || "plan")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "plan"
    );
  }

  function extractPlanPath(text) {
    var m = String(text || "").match(
      /\/home\/user\/(?:documents|projects)\/[^\s`"']+\.md/,
    );
    return m ? m[0] : null;
  }

  function handlePlanModeComplete(response, meta) {
    if (!isPlanMode() && !(meta && meta.forcePlanComplete)) return;
    var text = String(response || "");
    var path = extractPlanPath(text);
    var files = (meta && meta.filesTouched) || status.filesTouched || [];
    if (!path) {
      for (var i = files.length - 1; i >= 0; i--) {
        if (/\.md$/i.test(files[i]) && /plan/i.test(files[i])) {
          path = files[i];
          break;
        }
      }
    }
    window.__pendingExecutePlan = {
      path: path || null,
      text: text.slice(0, 12000),
      goal: (meta && meta.goal) || "",
      at: Date.now(),
    };
    paintMicroActions();
    if (window.ChatreKit && window.ChatreKit.toast) {
      window.ChatreKit.toast(
        path ? "Plan ready — Approve & execute" : "Plan ready — review then execute",
        "success",
      );
    }
  }

  function executeApprovedPlan() {
    var pending = window.__pendingExecutePlan;
    if (!pending) return;
    window.__pendingExecutePlan = null;
    paintMicroActions();
    // Leave plan mode → build orchestrator
    if (window.ChatreComposer && window.ChatreComposer.setMode) {
      window.ChatreComposer.setMode("agent");
    }
    if (window.ChatreAgents && window.ChatreAgents.setActive) {
      window.ChatreAgents.setActive("build");
    }
    var msg =
      "[Execute approved plan]\n" +
      "You are build orchestrator. Do NOT re-plan. Execute the plan artifact with tools. " +
      "Map with delegate_task(agent=explore) if needed; implement; verify with preview_project or delegate_task(agent=verify). " +
      "Prefer write_file under /home/user/projects/. Do not narrate file writes — call tools.\n\n";
    if (pending.path) {
      msg += "Plan file: " + pending.path + "\nRead it first with read_file, then execute every step.\n";
    } else if (pending.text) {
      msg += "Plan:\n" + pending.text.slice(0, 8000) + "\n";
    }
    if (window.ChatreUI && window.ChatreUI.composeAndSend) {
      window.ChatreUI.composeAndSend(msg);
    }
  }

  function markRunning(on, phase) {
    status.running = !!on;
    if (on) {
      if (phase) status.phase = phase;
      if (status.delivery == null) status.delivery = null;
    }
    updateStatusStack({});
    paintMicroActions();
    if (window.ChatreMotion && phase) {
      window.ChatreMotion.onPhaseChange(phase);
    }
  }

  function init() {
    var host = $("composer-micro-actions");
    if (host && !host._bound) {
      host._bound = true;
      host.addEventListener("click", onMicroClick);
    }
    paintMicroActions();
    updateStatusStack({});
  }

  window.ChatreComposerFlow = {
    init: init,
    isPlanMode: isPlanMode,
    buildPlanPrompt: buildPlanPrompt,
    wrapPlanMessage: wrapPlanMessage,
    updateStatusStack: updateStatusStack,
    noteToolResult: noteToolResult,
    noteDiagnostics: noteDiagnostics,
    resetStatus: resetStatus,
    markRunning: markRunning,
    paintMicroActions: paintMicroActions,
    handlePlanModeComplete: handlePlanModeComplete,
    executeApprovedPlan: executeApprovedPlan,
    status: status,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
