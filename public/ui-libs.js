/**
 * Chatre UI kit — Lucide icons, Tippy tooltips, Notyf toasts.
 */
(function () {
  "use strict";

  let notyf = null;

  function icon(name, opts) {
    opts = opts || {};
    const size = opts.size || 16;
    const cls = opts.className ? " " + opts.className : "";
    const span = document.createElement("span");
    span.className = "ui-icon" + cls;
    span.setAttribute("aria-hidden", "true");
    const i = document.createElement("i");
    i.setAttribute("data-lucide", name);
    i.style.width = size + "px";
    i.style.height = size + "px";
    span.appendChild(i);
    return span;
  }

  function iconHtml(name, size) {
    size = size || 16;
    return (
      '<i data-lucide="' +
      String(name).replace(/"/g, "") +
      '" style="width:' +
      size +
      "px;height:" +
      size +
      'px" aria-hidden="true"></i>'
    );
  }

  function labelWithIcon(name, text, size) {
    return iconHtml(name, size || 14) + '<span class="ui-label">' + text + "</span>";
  }

  function refreshIcons(root) {
    if (!window.lucide || typeof window.lucide.createIcons !== "function") return;
    try {
      if (root && root !== document.body && root.querySelectorAll) {
        root.querySelectorAll("[data-lucide]").forEach(function (node) {
          // ensure createIcons can see unresolved nodes
          if (node.tagName && node.tagName.toLowerCase() === "svg") return;
        });
      }
      window.lucide.createIcons({
        attrs: {
          "stroke-width": 1.75,
          class: "lucide-icon",
        },
        nameAttr: "data-lucide",
      });
    } catch (e) {
      try {
        window.lucide.createIcons();
      } catch {
        /* ignore */
      }
    }
  }

  function tip(el, content, opts) {
    if (!el || !window.tippy || !content) return null;
    opts = opts || {};
    if (el._tippy) {
      el._tippy.setContent(content);
      return el._tippy;
    }
    return window.tippy(el, {
      content: content,
      theme: "chatre",
      animation: "shift-away-subtle",
      delay: [180, 40],
      arrow: true,
      allowHTML: !!opts.allowHTML,
      placement: opts.placement || "bottom",
    });
  }

  function bindTips(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-tip]").forEach(function (node) {
      tip(node, node.getAttribute("data-tip"));
    });
  }

  function ensureToast() {
    if (notyf) return notyf;
    if (!window.Notyf) return null;
    notyf = new window.Notyf({
      duration: 3200,
      ripple: false,
      position: { x: "right", y: "bottom" },
      types: [
        {
          type: "success",
          background: "#1a3d2e",
          icon: false,
        },
        {
          type: "error",
          background: "#4a1f1f",
          icon: false,
        },
        {
          type: "info",
          background: "#1a2438",
          icon: false,
          className: "notyf__toast--info",
        },
      ],
    });
    return notyf;
  }

  function toast(message, type) {
    const n = ensureToast();
    const msg = String(message || "");
    if (!n) {
      if (type === "error") console.error(msg);
      else console.log(msg);
      return;
    }
    if (type === "error") n.error(msg);
    else if (type === "success") n.success(msg);
    else if (n.open) {
      n.open({ type: "info", message: msg });
    } else {
      n.success(msg);
    }
  }

  function decorateButtons() {
    const map = [
      ["#settings-open", "settings", "Settings"],
      ["#agent-resume", "play", "Resume interrupted agent run"],
      ["#terminal-toggle", "terminal", "Toggle terminal"],
      ["#toggle-threads", "messages-square", "Threads panel"],
      ["#toggle-files", "folder", "Files panel"],
      ["#toggle-browser", "globe", "Browser panel"],
      ["#toggle-threads-bar", "messages-square", "Threads"],
      ["#toggle-files-bar", "folder", "Files"],
      ["#toggle-browser-bar", "globe", "Browser"],
      ["#threads-new", "plus", "New thread"],
      ["#threads-refresh", "refresh-cw", "Refresh threads"],
      ["#files-refresh", "refresh-cw", "Refresh files"],
      ["#files-export-zip", "package", "Export workspace ZIP"],
      ["#stop-button", "square", "Stop generation"],
      ["#send-button", "send", "Send message"],
      ["#diff-modal-close", "x", "Close diff"],
      ["#terminal-close", "x", "Close terminal"],
    ];
    map.forEach(function (row) {
      const el = document.querySelector(row[0]);
      if (!el) return;
      const label = (el.textContent || "").trim();
      el.innerHTML = labelWithIcon(row[1], label || row[2], 15);
      if (!el.getAttribute("data-tip") && row[2]) {
        el.setAttribute("data-tip", row[2]);
      }
    });

    const modeIcons = { chat: "message-circle", agent: "bot", image: "image" };
    document.querySelectorAll("#mode-control [data-mode]").forEach(function (btn) {
      const mode = btn.getAttribute("data-mode");
      const label = (btn.textContent || "").trim();
      if (modeIcons[mode]) {
        btn.innerHTML = labelWithIcon(modeIcons[mode], label, 14);
      }
    });

    const panels = [
      ["#threads-panel .panel-head h2", "messages-square", "Threads"],
      ["#files-panel > h2", "folder-open", "Workspace"],
      ["#browser-panel > h2", "globe", "Browser"],
      ["#plan-drawer-panel > h2", "list-checks", "Plan"],
    ];
    panels.forEach(function (row) {
      const h = document.querySelector(row[0]);
      if (!h) return;
      h.innerHTML = labelWithIcon(row[1], row[2], 16);
    });

    const collapse = document.getElementById("threads-collapse");
    if (collapse && !collapse.querySelector("[data-lucide], svg")) {
      collapse.innerHTML = iconHtml("panel-left-close", 15);
    }
    const rail = document.getElementById("threads-rail");
    if (rail && !rail.querySelector("[data-lucide], svg")) {
      rail.innerHTML = iconHtml("panel-left-open", 16);
    }

    const more = document.querySelector(".toolbar-more > summary");
    if (more) more.innerHTML = labelWithIcon("more-horizontal", "More", 14);

    const drop = document.getElementById("file-drop");
    if (drop) {
      /* markup provided in HTML */
    }
  }

  function init() {
    decorateButtons();
    refreshIcons();
    bindTips();
    ensureToast();
  }

  window.ChatreKit = {
    init: init,
    icon: icon,
    iconHtml: iconHtml,
    labelWithIcon: labelWithIcon,
    refreshIcons: refreshIcons,
    tip: tip,
    bindTips: bindTips,
    toast: toast,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
