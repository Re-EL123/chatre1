/**
 * Chatre motion — live animations for messages, tools, phases, panels.
 * Respects prefers-reduced-motion.
 */
(function () {
  "use strict";

  var reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function animateIn(el, kind) {
    if (!el || reduced) return el;
    var cls = "ch-motion-in";
    if (kind === "tool") cls = "ch-motion-tool-in";
    else if (kind === "pill") cls = "ch-motion-pill-in";
    else if (kind === "file") cls = "ch-motion-file-in";
    else if (kind === "phase") cls = "ch-motion-phase-in";
    else if (kind === "panel") cls = "ch-motion-panel-in";
    else if (kind === "flash") cls = "ch-motion-flash";
    el.classList.remove(cls);
    // force reflow so re-trigger works
    void el.offsetWidth;
    el.classList.add(cls);
    return el;
  }

  function markToolRunning(card) {
    if (!card) return;
    card.classList.add("is-running");
    card.classList.remove("is-done", "is-error", "ch-motion-tool-done", "ch-motion-tool-error");
    animateIn(card, "tool");
  }

  function markToolDone(card, ok) {
    if (!card) return;
    card.classList.remove("is-running");
    if (ok === false) {
      card.classList.add("is-error");
      card.classList.remove("is-done");
      if (!reduced) {
        card.classList.remove("ch-motion-tool-error");
        void card.offsetWidth;
        card.classList.add("ch-motion-tool-error");
      }
    } else {
      card.classList.add("is-done");
      card.classList.remove("is-error");
      if (!reduced) {
        card.classList.remove("ch-motion-tool-done");
        void card.offsetWidth;
        card.classList.add("ch-motion-tool-done");
      }
    }
  }

  function staggerChildren(host, kind, delayMs) {
    if (!host || reduced) return;
    var kids = host.children;
    var step = delayMs == null ? 40 : delayMs;
    for (var i = 0; i < kids.length; i++) {
      (function (el, idx) {
        el.style.setProperty("--ch-stagger", idx * step + "ms");
        animateIn(el, kind || "pill");
      })(kids[i], i);
    }
  }

  function pulse(el) {
    if (!el || reduced) return;
    el.classList.remove("ch-motion-pulse");
    void el.offsetWidth;
    el.classList.add("ch-motion-pulse");
  }

  function flashPath(path) {
    if (!path || reduced) return;
    var rows = document.querySelectorAll(".file-item[data-path]");
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute("data-path") === path) {
        animateIn(rows[i], "flash");
        break;
      }
    }
  }

  function onMessageAdded(el) {
    if (!el) return;
    if (el.classList.contains("user-message")) animateIn(el, "msg");
    else animateIn(el, "msg");
    el.classList.add("ch-motion-msg");
  }

  function onPhaseChange(text) {
    var phase = $("composer-busy-phase");
    if (phase) {
      phase.textContent = text || phase.textContent;
      pulse(phase);
      animateIn(phase, "phase");
    }
    var run = $("composer-run");
    if (run && !run.hidden) pulse(run);
  }

  function observeChat() {
    var host = document.getElementById("chat-messages");
    if (!host || host._chMotionObs) return;
    host._chMotionObs = true;
    if (typeof MutationObserver === "undefined") return;
    var obs = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        for (var i = 0; i < m.addedNodes.length; i++) {
          var n = m.addedNodes[i];
          if (n.nodeType !== 1) continue;
          if (n.classList && n.classList.contains("message")) {
            onMessageAdded(n);
          }
          if (n.classList && n.classList.contains("tool-call")) {
            markToolRunning(n);
          }
          var tools = n.querySelectorAll && n.querySelectorAll(".tool-call");
          if (tools) {
            for (var t = 0; t < tools.length; t++) markToolRunning(tools[t]);
          }
        }
      });
    });
    obs.observe(host, { childList: true, subtree: true });
  }

  function init() {
    observeChat();
    document.documentElement.classList.toggle("ch-reduced-motion", !!reduced);
  }

  window.ChatreMotion = {
    init: init,
    reduced: reduced,
    animateIn: animateIn,
    markToolRunning: markToolRunning,
    markToolDone: markToolDone,
    staggerChildren: staggerChildren,
    pulse: pulse,
    flashPath: flashPath,
    onMessageAdded: onMessageAdded,
    onPhaseChange: onPhaseChange,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
