/**
 * Chatre Composer — modes, context chips, @mentions, drafts, queue,
 * command palette, live guidance, voice, and safety notices.
 */
(function () {
  "use strict";

  var MODES = [
    {
      id: "chat",
      label: "Chat",
      placeholder: "Ask anything…",
      agent: false,
      browser: false,
      desktop: false,
    },
    {
      id: "agent",
      label: "Agent",
      placeholder: "Describe a task to plan and execute…",
      agent: true,
      browser: false,
      desktop: false,
    },
    {
      id: "browse",
      label: "Browse",
      placeholder: "Describe the site or page to open…",
      agent: true,
      browser: true,
      desktop: false,
    },
    {
      id: "desktop",
      label: "Desktop",
      placeholder: "Ask for a desktop action (companion required)…",
      agent: true,
      browser: false,
      desktop: true,
    },
    {
      id: "code",
      label: "Code",
      placeholder: "Describe code to build, fix, or review…",
      agent: true,
      browser: false,
      desktop: false,
    },
    {
      id: "image",
      label: "Image",
      placeholder: "Describe an image to generate…",
      agent: false,
      browser: false,
      desktop: false,
      image: true,
    },
  ];

  var state = {
    mode: "agent",
    attachments: [], // { kind, id, label, path?, url?, value? }
    queue: [],
    draftTimer: null,
    mentionOpen: false,
    mentionItems: [],
    mentionIndex: 0,
    mentionQuery: "",
    paletteOpen: false,
    paletteIndex: 0,
    paletteQuery: "",
    listening: false,
    recognition: null,
    enterSends: false, // false = Ctrl/Cmd+Enter sends (default)
  };

  function $(id) {
    return document.getElementById(id);
  }

  function kit() {
    return window.ChatreKit;
  }

  function threadKey() {
    var id =
      (window.ChatrePanels &&
        window.ChatrePanels.state &&
        window.ChatrePanels.state.threadId) ||
      "local";
    return "chatre.composer.draft." + id;
  }

  function loadPrefs() {
    try {
      var m = localStorage.getItem("chatre.composer.mode");
      if (m && MODES.some(function (x) {
        return x.id === m;
      })) {
        state.mode = m;
      }
      state.enterSends = localStorage.getItem("chatre.composer.enter_sends") === "1";
    } catch (e) {
      /* ignore */
    }
  }

  function saveMode() {
    try {
      localStorage.setItem("chatre.composer.mode", state.mode);
    } catch (e) {
      /* ignore */
    }
  }

  function modeObj() {
    return (
      MODES.find(function (m) {
        return m.id === state.mode;
      }) || MODES[1]
    );
  }

  function getMode() {
    return state.mode;
  }

  function setMode(id, opts) {
    if (!MODES.some(function (m) {
      return m.id === id;
    }))
      return;
    state.mode = id;
    saveMode();
    paintModes();
    paintSafety();
    paintPlaceholder();
    paintChips();
    if (!(opts && opts.skipAgent)) {
      var m = modeObj();
      if (window.ChatreUI && window.ChatreUI.setAgentMode) {
        window.ChatreUI.setAgentMode(!!m.agent);
      }
      if (window.ChatreUI && window.ChatreUI.setImageMode) {
        window.ChatreUI.setImageMode(!!m.image || state.mode === "image");
      }
    }
  }

  function paintModes() {
    var host = $("composer-modes");
    if (!host) return;
    host.innerHTML = MODES.map(function (m) {
      return (
        '<button type="button" class="composer-mode-btn' +
        (m.id === state.mode ? " active" : "") +
        '" data-mode="' +
        m.id +
        '">' +
        m.label +
        "</button>"
      );
    }).join("");
  }

  function paintPlaceholder() {
    var input = $("user-input");
    if (!input) return;
    var m = modeObj();
    var sendHint = state.enterSends
      ? "Enter to send · Shift+Enter newline"
      : "⌘/Ctrl+Enter to send · Esc to stop";
    input.placeholder = m.placeholder + " · " + sendHint;
  }

  function paintSafety() {
    var el = $("composer-safety");
    if (!el) return;
    var m = modeObj();
    if (m.desktop || state.mode === "desktop") {
      el.hidden = false;
      el.textContent =
        "Desktop mode can control your machine via the companion. Confirm sensitive actions.";
    } else {
      el.hidden = true;
      el.textContent = "";
    }
  }

  function chipHtml(chip, removable) {
    return (
      '<button type="button" class="composer-chip" data-chip-id="' +
      escapeAttr(chip.id) +
      '"' +
      (removable ? ' data-removable="1"' : "") +
      ">" +
      '<span class="composer-chip-kind">' +
      escapeHtml(chip.kind) +
      "</span> " +
      escapeHtml(chip.label) +
      (removable ? ' <span class="composer-chip-x" aria-hidden="true">×</span>' : "") +
      "</button>"
    );
  }

  function paintChips() {
    var host = $("composer-context-chips");
    if (!host) return;
    var chips = [];
    var model = $("model-select");
    if (model && model.value) {
      chips.push({
        id: "model",
        kind: "model",
        label: String(model.value).replace(/^[^:]+:/, "").slice(0, 36),
      });
    }
    chips.push({ id: "mode", kind: "mode", label: modeObj().label });
    var threadLabel =
      (window.ChatrePanels &&
        window.ChatrePanels.state &&
        window.ChatrePanels.state.threadTitle) ||
      "";
    if (threadLabel) {
      chips.push({
        id: "thread",
        kind: "thread",
        label: String(threadLabel).slice(0, 28),
      });
    }
    state.attachments.forEach(function (a) {
      chips.push(a);
    });
    host.innerHTML = chips
      .map(function (c) {
        return chipHtml(c, !!c.removable || state.attachments.some(function (a) {
          return a.id === c.id;
        }));
      })
      .join("");
  }

  function addAttachment(chip) {
    var id = chip.id || chip.kind + ":" + (chip.path || chip.url || chip.label);
    if (
      state.attachments.some(function (a) {
        return a.id === id;
      })
    )
      return;
    state.attachments.push({
      id: id,
      kind: chip.kind,
      label: chip.label,
      path: chip.path,
      url: chip.url,
      value: chip.value,
      removable: true,
    });
    paintChips();
  }

  function removeAttachment(id) {
    state.attachments = state.attachments.filter(function (a) {
      return a.id !== id;
    });
    paintChips();
  }

  function composerFlags() {
    var m = modeObj();
    return {
      useBrowser: !!m.browser,
      useDesktop: !!m.desktop,
      mode: m.id,
      agent: !!m.agent,
    };
  }

  function enrichMessage(message) {
    var bits = [];
    var f = composerFlags();
    if (f.mode === "code") {
      bits.push("[Prefer coding tools: explore, patch_file, execute_command, verify.]");
    }
    if (f.useBrowser) {
      bits.push("[Use the cloud browser tools for this task.]");
    }
    if (f.useDesktop) {
      bits.push(
        "[Use desktop companion tools when helpful. Require approval for desktop_exec.]",
      );
    }
    state.attachments.forEach(function (a) {
      if (a.kind === "file" || a.kind === "folder") {
        bits.push("[Context " + a.kind + ": " + (a.path || a.label) + "]");
      } else if (a.kind === "url") {
        bits.push("[Context url: " + (a.url || a.label) + "]");
      } else if (a.kind === "artifact") {
        bits.push("[Context artifact: " + (a.path || a.label) + "]");
      } else if (a.kind === "memory") {
        bits.push(
          "[Context memory " +
            a.label +
            (a.value != null ? ": " + String(a.value).slice(0, 500) : "") +
            "]",
        );
      } else if (a.kind === "selection") {
        bits.push("[Context selection: " + String(a.value || a.label).slice(0, 2000) + "]");
      }
    });
    if (!bits.length) return message;
    return bits.join(" ") + "\n\n" + message;
  }

  function prefixFromFlags(message) {
    return enrichMessage(message);
  }

  function clearAttachmentsAfterSend() {
    state.attachments = [];
    paintChips();
  }

  // ── Draft autosave ─────────────────────────────────────────────────
  function saveDraft() {
    var input = $("user-input");
    if (!input) return;
    try {
      localStorage.setItem(threadKey(), input.value || "");
    } catch (e) {
      /* ignore */
    }
  }

  function restoreDraft() {
    var input = $("user-input");
    if (!input) return;
    try {
      var d = localStorage.getItem(threadKey());
      if (d && !input.value) {
        input.value = d;
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 200) + "px";
      }
    } catch (e) {
      /* ignore */
    }
  }

  function clearDraft() {
    try {
      localStorage.removeItem(threadKey());
    } catch (e) {
      /* ignore */
    }
  }

  // ── Queue while busy ───────────────────────────────────────────────
  function enqueue(message) {
    state.queue.push(message);
    paintQueue();
    if (kit()) kit().toast("Queued for after this run", "success");
  }

  function paintQueue() {
    var el = $("composer-queue");
    if (!el) return;
    if (!state.queue.length) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.hidden = false;
    el.innerHTML =
      '<span class="composer-queue-label">Queued (' +
      state.queue.length +
      ")</span> " +
      state.queue
        .map(function (q, i) {
          return (
            '<button type="button" class="composer-chip" data-queue-i="' +
            i +
            '">' +
            escapeHtml(String(q).slice(0, 40)) +
            ' <span class="composer-chip-x">×</span></button>'
          );
        })
        .join("");
  }

  function flushQueue() {
    if (!state.queue.length) return;
    var next = state.queue.shift();
    paintQueue();
    if (next && window.ChatreUI && window.ChatreUI.composeAndSend) {
      window.ChatreUI.composeAndSend(next);
    }
  }

  // ── Mentions ───────────────────────────────────────────────────────
  function filePaths() {
    var paths = [];
    if (window.ChatrePanels && window.ChatrePanels.state && window.ChatrePanels.state.files) {
      Object.keys(window.ChatrePanels.state.files).forEach(function (p) {
        var f = window.ChatrePanels.state.files[p];
        if (f && f.type === "file") paths.push({ kind: "file", path: p, label: p });
        if (f && f.type === "dir") paths.push({ kind: "folder", path: p, label: p });
      });
    }
    return paths;
  }

  function buildMentionItems(query) {
    var q = String(query || "").toLowerCase();
    var items = [];
    filePaths().forEach(function (p) {
      if (!q || p.path.toLowerCase().indexOf(q) !== -1) {
        items.push({
          kind: p.kind,
          label: p.path,
          path: p.path,
          insert: "@" + p.kind + ":" + p.path,
        });
      }
    });
    if (!q || "url".indexOf(q) === 0) {
      items.push({
        kind: "url",
        label: "Paste a URL…",
        insert: "@url:",
      });
    }
    if (window.ChatreUIAdv && window.ChatreUIAdv.listArtifacts) {
      try {
        (window.ChatreUIAdv.listArtifacts() || []).forEach(function (a) {
          var lab = a.path || a.title || "artifact";
          if (!q || String(lab).toLowerCase().indexOf(q) !== -1) {
            items.push({
              kind: "artifact",
              label: lab,
              path: a.path,
              insert: "@artifact:" + (a.path || lab),
            });
          }
        });
      } catch (e) {
        /* ignore */
      }
    }
    if (!q || "memory".indexOf(q) === 0) {
      items.push({
        kind: "memory",
        label: "Load memory key…",
        insert: "@memory:",
      });
    }
    return items.slice(0, 12);
  }

  function paintMentions() {
    var box = $("mention-suggestions");
    if (!box) return;
    if (!state.mentionOpen || !state.mentionItems.length) {
      box.style.display = "none";
      box.innerHTML = "";
      return;
    }
    box.style.display = "block";
    box.innerHTML = state.mentionItems
      .map(function (it, i) {
        return (
          '<div class="slash-suggestion-item' +
          (i === state.mentionIndex ? " active" : "") +
          '" data-mention-i="' +
          i +
          '" role="option">' +
          "<strong>" +
          escapeHtml(it.kind) +
          "</strong> " +
          escapeHtml(it.label) +
          "</div>"
        );
      })
      .join("");
  }

  function applyMention(item) {
    var input = $("user-input");
    if (!input || !item) return;
    var val = input.value;
    var at = val.lastIndexOf("@");
    if (at < 0) return;
    var before = val.slice(0, at);
    var afterCursor = "";
    var insert = item.insert + " ";
    input.value = before + insert + afterCursor;
    if (item.kind === "file" || item.kind === "folder" || item.kind === "artifact") {
      addAttachment({
        kind: item.kind,
        label: item.label,
        path: item.path,
      });
    }
    state.mentionOpen = false;
    paintMentions();
    input.focus();
  }

  async function resolveInlineMentions(text) {
    var out = text;
    var re = /@(file|folder|url|artifact|memory):([^\s]+)/g;
    var m;
    var pending = [];
    while ((m = re.exec(text))) {
      pending.push({ kind: m[1], value: m[2], raw: m[0] });
    }
    for (var i = 0; i < pending.length; i++) {
      var p = pending[i];
      if (p.kind === "memory" && window.ChatreRemote && window.ChatreRemote.memoryGet) {
        try {
          var mem = await window.ChatreRemote.memoryGet(p.value);
          addAttachment({
            kind: "memory",
            label: p.value,
            value: mem && mem.value,
          });
        } catch (e) {
          addAttachment({ kind: "memory", label: p.value });
        }
      } else if (p.kind === "url") {
        addAttachment({ kind: "url", label: p.value, url: p.value });
      } else {
        addAttachment({
          kind: p.kind,
          label: p.value,
          path: p.value,
        });
      }
    }
    return out;
  }

  // ── Command palette ────────────────────────────────────────────────
  function paletteCommands() {
    var base = [
      {
        cat: "run",
        cmd: "/run",
        desc: "Run a shell command",
        run: function (arg) {
          if (window.ChatreUI && window.ChatreUI.runShell) {
            window.ChatreUI.runShell(arg);
          } else if (window.ChatreUI && window.ChatreUI.composeAndSend) {
            window.ChatreUI.composeAndSend("/run " + (arg || ""));
          }
        },
      },
      {
        cat: "image",
        cmd: "/image",
        desc: "Generate an image",
        run: function (arg) {
          if (window.ChatreUI && window.ChatreUI.composeAndSend) {
            window.ChatreUI.composeAndSend("/image " + (arg || "skyline"));
          }
        },
      },
      {
        cat: "model",
        cmd: "/model",
        desc: "Show active model",
        run: function () {
          if (window.ChatreUI && window.ChatreUI.composeAndSend) {
            window.ChatreUI.composeAndSend("/model");
          }
        },
      },
      {
        cat: "terminal",
        cmd: "/terminal",
        desc: "Toggle terminal",
        run: function () {
          if (window.ChatreUI && window.ChatreUI.composeAndSend) {
            window.ChatreUI.composeAndSend("/terminal");
          }
        },
      },
      {
        cat: "settings",
        cmd: "/settings",
        desc: "Open settings",
        run: function () {
          if (window.ChatreUX && window.ChatreUX.openSettings) {
            window.ChatreUX.openSettings();
          }
        },
      },
      {
        cat: "mode",
        cmd: "/mode chat",
        desc: "Switch to Chat mode",
        run: function () {
          setMode("chat");
        },
      },
      {
        cat: "mode",
        cmd: "/mode agent",
        desc: "Switch to Agent mode",
        run: function () {
          setMode("agent");
        },
      },
      {
        cat: "mode",
        cmd: "/mode browse",
        desc: "Switch to Browse mode",
        run: function () {
          setMode("browse");
        },
      },
      {
        cat: "mode",
        cmd: "/mode desktop",
        desc: "Switch to Desktop mode",
        run: function () {
          setMode("desktop");
        },
      },
      {
        cat: "mode",
        cmd: "/mode code",
        desc: "Switch to Code mode",
        run: function () {
          setMode("code");
        },
      },
      {
        cat: "mode",
        cmd: "/mode image",
        desc: "Switch to Image mode",
        run: function () {
          setMode("image");
        },
      },
      {
        cat: "run",
        cmd: "/clear",
        desc: "Clear chat",
        run: function () {
          if (window.ChatreUI && window.ChatreUI.composeAndSend) {
            window.ChatreUI.composeAndSend("/clear");
          }
        },
      },
      {
        cat: "run",
        cmd: "/help",
        desc: "Show help",
        run: function () {
          if (window.ChatreUI && window.ChatreUI.composeAndSend) {
            window.ChatreUI.composeAndSend("/help");
          }
        },
      },
    ];
    // Recent drafts / starters
    try {
      var recent = JSON.parse(localStorage.getItem("chatre.composer.recent") || "[]");
      recent.slice(0, 5).forEach(function (r, i) {
        base.push({
          cat: "recent",
          cmd: "recent:" + i,
          desc: String(r).slice(0, 60),
          run: function () {
            var input = $("user-input");
            if (input) {
              input.value = r;
              input.focus();
            }
          },
        });
      });
    } catch (e) {
      /* ignore */
    }
    return base;
  }

  function fuzzyMatch(query, text) {
    var q = String(query || "").toLowerCase().trim();
    var t = String(text || "").toLowerCase();
    if (!q) return true;
    if (t.indexOf(q) !== -1) return true;
    var qi = 0;
    for (var i = 0; i < t.length && qi < q.length; i++) {
      if (t[i] === q[qi]) qi++;
    }
    return qi === q.length;
  }

  function openPalette(seed) {
    state.paletteOpen = true;
    state.paletteQuery = seed || "";
    state.paletteIndex = 0;
    var overlay = $("composer-palette");
    var input = $("composer-palette-input");
    if (overlay) {
      overlay.hidden = false;
      overlay.classList.add("open");
    }
    if (input) {
      input.value = state.paletteQuery;
      input.focus();
    }
    paintPalette();
  }

  function closePalette() {
    state.paletteOpen = false;
    var overlay = $("composer-palette");
    if (overlay) {
      overlay.classList.remove("open");
      overlay.hidden = true;
    }
  }

  function paintPalette() {
    var list = $("composer-palette-list");
    if (!list) return;
    var q = state.paletteQuery;
    var items = paletteCommands().filter(function (c) {
      return fuzzyMatch(q, c.cmd + " " + c.desc + " " + c.cat);
    });
    if (!items.length) {
      list.innerHTML = '<div class="palette-empty">No matches</div>';
      return;
    }
    if (state.paletteIndex >= items.length) state.paletteIndex = 0;
    list.innerHTML = items
      .map(function (c, i) {
        return (
          '<button type="button" class="palette-item' +
          (i === state.paletteIndex ? " selected" : "") +
          '" data-palette-i="' +
          i +
          '">' +
          '<span class="palette-cat">' +
          escapeHtml(c.cat) +
          "</span>" +
          "<strong>" +
          escapeHtml(c.cmd) +
          "</strong>" +
          "<span>" +
          escapeHtml(c.desc) +
          "</span></button>"
        );
      })
      .join("");
    list._items = items;
  }

  function runPaletteIndex(i) {
    var list = $("composer-palette-list");
    var items = (list && list._items) || [];
    var item = items[i];
    if (!item) return;
    closePalette();
    item.run("");
  }

  // ── Busy strip + guidance ─────────────────────────────────────────
  function setBusyUi(busy, meta) {
    var strip = $("composer-busy");
    var send = $("send-button");
    var guide = $("composer-guidance");
    if (strip) {
      strip.hidden = !busy;
      if (busy) {
        var phase = "Working…";
        var tool = "";
        if (typeof meta === "string") {
          if (meta === "agent") phase = "Agent running…";
          else if (meta === "image") phase = "Generating image…";
          else phase = "Working…";
        } else if (meta && typeof meta === "object") {
          phase = meta.phase || meta.step || "Working…";
          tool = meta.tool || meta.lastTool || "";
        }
        if ($("composer-busy-phase")) $("composer-busy-phase").textContent = phase;
        if ($("composer-busy-tool")) {
          $("composer-busy-tool").textContent = tool ? "· " + tool : "";
        }
      }
    }
    if (guide) guide.hidden = !busy;
    if (send) {
      send.textContent = busy ? "Queue" : "Send";
      send.disabled = false;
    }
    document.body.classList.toggle("composer-busy", !!busy);
  }

  function sendGuidance() {
    var input = $("composer-guidance-input");
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    // Inject as a user message into the live agent via compose queue or note
    if (window.ChatreUI && window.ChatreUI.injectGuidance) {
      window.ChatreUI.injectGuidance(text);
    } else {
      enqueue("[Guidance for current run] " + text);
    }
    if (kit()) kit().toast("Guidance queued", "success");
  }

  // ── Voice ──────────────────────────────────────────────────────────
  function toggleVoice() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var btn = $("composer-mic");
    if (!SR) {
      if (kit()) kit().toast("Speech recognition not supported in this browser", "error");
      return;
    }
    if (state.listening && state.recognition) {
      try {
        state.recognition.stop();
      } catch (e) {
        /* ignore */
      }
      state.listening = false;
      if (btn) btn.classList.remove("active");
      return;
    }
    var rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-US";
    state.recognition = rec;
    state.listening = true;
    if (btn) btn.classList.add("active");
    rec.onresult = function (ev) {
      var input = $("user-input");
      if (!input) return;
      var transcript = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        transcript += ev.results[i][0].transcript;
      }
      input.value = (input.value ? input.value.replace(/\s+$/, "") + " " : "") + transcript.trim();
      input.dispatchEvent(new Event("input"));
    };
    rec.onerror = function () {
      state.listening = false;
      if (btn) btn.classList.remove("active");
    };
    rec.onend = function () {
      state.listening = false;
      if (btn) btn.classList.remove("active");
    };
    try {
      rec.start();
    } catch (e) {
      state.listening = false;
      if (btn) btn.classList.remove("active");
    }
  }

  // ── Edit last ──────────────────────────────────────────────────────
  function editLast() {
    var hist =
      (window.ChatreUI && window.ChatreUI.getHistory && window.ChatreUI.getHistory()) ||
      [];
    for (var i = hist.length - 1; i >= 0; i--) {
      if (hist[i].role === "user") {
        var input = $("user-input");
        if (input) {
          input.value = hist[i].content;
          input.focus();
          input.dispatchEvent(new Event("input"));
        }
        return;
      }
    }
    if (kit()) kit().toast("No previous user message", "error");
  }

  function rememberRecent(msg) {
    try {
      var arr = JSON.parse(localStorage.getItem("chatre.composer.recent") || "[]");
      arr = [msg].concat(
        arr.filter(function (x) {
          return x !== msg;
        }),
      );
      localStorage.setItem("chatre.composer.recent", JSON.stringify(arr.slice(0, 12)));
    } catch (e) {
      /* ignore */
    }
  }

  // ── Drag/drop on composer ──────────────────────────────────────────
  function initDrop() {
    var wrap = document.querySelector(".message-input-wrap");
    if (!wrap) return;
    wrap.addEventListener("dragover", function (e) {
      e.preventDefault();
      wrap.classList.add("composer-drop");
    });
    wrap.addEventListener("dragleave", function () {
      wrap.classList.remove("composer-drop");
    });
    wrap.addEventListener("drop", function (e) {
      e.preventDefault();
      wrap.classList.remove("composer-drop");
      var files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      if (files.length && window.ChatrePanels && window.ChatrePanels.uploadLocalFiles) {
        window.ChatrePanels.uploadLocalFiles(files).then(function (paths) {
          (paths || files).forEach(function (p, i) {
            var name = typeof p === "string" ? p : files[i].name;
            addAttachment({
              kind: "file",
              label: String(name).split("/").pop(),
              path: typeof p === "string" ? p : "/home/user/uploads/" + files[i].name,
            });
          });
          if (kit()) kit().toast("Attached " + files.length + " file(s)", "success");
        });
      }
      var uri = e.dataTransfer && e.dataTransfer.getData("text/uri-list");
      if (uri && /^https?:\/\//i.test(uri.trim())) {
        addAttachment({ kind: "url", label: uri.trim(), url: uri.trim() });
      }
    });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function shouldQueueInsteadOfSend() {
    return document.body.classList.contains("is-working");
  }

  function wantsAgentFromMode() {
    return !!modeObj().agent;
  }

  function wantsImageFromMode() {
    return state.mode === "image" || !!(modeObj().image);
  }

  function init() {
    loadPrefs();
    paintModes();
    paintSafety();
    paintPlaceholder();
    paintChips();
    restoreDraft();
    initDrop();

    var modes = $("composer-modes");
    if (modes) {
      modes.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-mode]");
        if (btn) setMode(btn.getAttribute("data-mode"));
      });
    }

    var chips = $("composer-context-chips");
    if (chips) {
      chips.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-chip-id]");
        if (!btn) return;
        var id = btn.getAttribute("data-chip-id");
        if (id === "model" || id === "mode" || id === "thread") return;
        removeAttachment(id);
      });
    }

    var queue = $("composer-queue");
    if (queue) {
      queue.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-queue-i]");
        if (!btn) return;
        var i = Number(btn.getAttribute("data-queue-i"));
        state.queue.splice(i, 1);
        paintQueue();
      });
    }

    var attach = $("composer-attach");
    var fileInput = $("composer-file-input");
    if (attach && fileInput) {
      attach.addEventListener("click", function () {
        fileInput.click();
      });
      fileInput.addEventListener("change", function () {
        var files = Array.from(fileInput.files || []);
        if (!files.length) return;
        if (window.ChatrePanels && window.ChatrePanels.uploadLocalFiles) {
          window.ChatrePanels.uploadLocalFiles(files).then(function () {
            files.forEach(function (f) {
              addAttachment({
                kind: "file",
                label: f.name,
                path: "/home/user/uploads/" + f.name,
              });
            });
            if (kit()) kit().toast("Uploaded " + files.length + " file(s)", "success");
          });
        }
        fileInput.value = "";
      });
    }

    var input = $("user-input");
    if (input) {
      input.addEventListener("input", function () {
        clearTimeout(state.draftTimer);
        state.draftTimer = setTimeout(saveDraft, 250);
        // mention trigger
        var val = input.value;
        var caret = input.selectionStart || val.length;
        var left = val.slice(0, caret);
        var at = left.lastIndexOf("@");
        if (at >= 0 && !/\s/.test(left.slice(at))) {
          var q = left.slice(at + 1);
          if (q.indexOf(" ") === -1) {
            state.mentionOpen = true;
            state.mentionQuery = q;
            state.mentionItems = buildMentionItems(q);
            state.mentionIndex = 0;
            paintMentions();
            return;
          }
        }
        state.mentionOpen = false;
        paintMentions();
      });

      input.addEventListener("paste", function (e) {
        var text = (e.clipboardData || window.clipboardData).getData("text");
        if (text && /^https?:\/\/\S+$/i.test(text.trim())) {
          setTimeout(function () {
            addAttachment({
              kind: "url",
              label: text.trim(),
              url: text.trim(),
            });
          }, 0);
        }
      });

      input.addEventListener("keydown", function (e) {
        if (state.mentionOpen && state.mentionItems.length) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            state.mentionIndex =
              (state.mentionIndex + 1) % state.mentionItems.length;
            paintMentions();
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            state.mentionIndex =
              (state.mentionIndex - 1 + state.mentionItems.length) %
              state.mentionItems.length;
            paintMentions();
            return;
          }
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            applyMention(state.mentionItems[state.mentionIndex]);
            return;
          }
          if (e.key === "Escape") {
            state.mentionOpen = false;
            paintMentions();
            e.preventDefault();
            return;
          }
        }

        if (e.key === "Enter" && !e.shiftKey) {
          // Send is handled by chat.js so Enter prefs stay consistent.
          return;
        }
      });
    }

    var mentionBox = $("mention-suggestions");
    if (mentionBox) {
      mentionBox.addEventListener("mousedown", function (e) {
        var row = e.target.closest("[data-mention-i]");
        if (!row) return;
        e.preventDefault();
        applyMention(state.mentionItems[Number(row.getAttribute("data-mention-i"))]);
      });
    }

    var mic = $("composer-mic");
    if (mic) mic.addEventListener("click", toggleVoice);

    var editBtn = $("composer-edit-last");
    if (editBtn) editBtn.addEventListener("click", editLast);

    var paletteBtn = $("composer-palette-btn");
    if (paletteBtn) {
      paletteBtn.addEventListener("click", function () {
        openPalette("");
      });
    }

    var paletteInput = $("composer-palette-input");
    if (paletteInput) {
      paletteInput.addEventListener("input", function () {
        state.paletteQuery = paletteInput.value;
        state.paletteIndex = 0;
        paintPalette();
      });
      paletteInput.addEventListener("keydown", function (e) {
        var list = $("composer-palette-list");
        var items = (list && list._items) || [];
        if (e.key === "ArrowDown") {
          e.preventDefault();
          state.paletteIndex = (state.paletteIndex + 1) % Math.max(items.length, 1);
          paintPalette();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          state.paletteIndex =
            (state.paletteIndex - 1 + items.length) % Math.max(items.length, 1);
          paintPalette();
        } else if (e.key === "Enter") {
          e.preventDefault();
          runPaletteIndex(state.paletteIndex);
        } else if (e.key === "Escape") {
          e.preventDefault();
          closePalette();
        }
      });
    }
    var paletteList = $("composer-palette-list");
    if (paletteList) {
      paletteList.addEventListener("click", function (e) {
        var row = e.target.closest("[data-palette-i]");
        if (!row) return;
        runPaletteIndex(Number(row.getAttribute("data-palette-i")));
      });
    }
    var paletteClose = $("composer-palette-close");
    if (paletteClose) paletteClose.addEventListener("click", closePalette);
    var paletteOverlay = $("composer-palette");
    if (paletteOverlay) {
      paletteOverlay.addEventListener("click", function (e) {
        if (e.target === paletteOverlay) closePalette();
      });
    }

    var guideBtn = $("composer-guidance-send");
    if (guideBtn) guideBtn.addEventListener("click", sendGuidance);
    var guideInput = $("composer-guidance-input");
    if (guideInput) {
      guideInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          sendGuidance();
        }
      });
    }

    var enterSel = $("composer-enter-pref");
    if (enterSel) {
      enterSel.value = state.enterSends ? "enter" : "mod-enter";
      enterSel.addEventListener("change", function () {
        state.enterSends = enterSel.value === "enter";
        try {
          localStorage.setItem(
            "chatre.composer.enter_sends",
            state.enterSends ? "1" : "0",
          );
        } catch (e) {
          /* ignore */
        }
        paintPlaceholder();
      });
    }

    // Sync mode with agent button if present
    setMode(state.mode, { skipAgent: false });

    // Refresh chips when model changes
    var model = $("model-select");
    if (model) {
      model.addEventListener("change", paintChips);
    }

    document.addEventListener("keydown", function (e) {
      var meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (state.paletteOpen) closePalette();
        else openPalette("");
      }
    });

    if (kit()) kit().refreshIcons(document.querySelector(".message-input-wrap"));
  }

  window.ChatreComposer = {
    init: init,
    getMode: getMode,
    setMode: setMode,
    composerFlags: composerFlags,
    prefixFromFlags: prefixFromFlags,
    enrichMessage: enrichMessage,
    resolveInlineMentions: resolveInlineMentions,
    shouldQueueInsteadOfSend: shouldQueueInsteadOfSend,
    enqueue: enqueue,
    flushQueue: flushQueue,
    clearDraft: clearDraft,
    saveDraft: saveDraft,
    restoreDraft: restoreDraft,
    clearAttachmentsAfterSend: clearAttachmentsAfterSend,
    rememberRecent: rememberRecent,
    setBusyUi: setBusyUi,
    paintChips: paintChips,
    addAttachment: addAttachment,
    wantsAgentFromMode: wantsAgentFromMode,
    wantsImageFromMode: wantsImageFromMode,
    openPalette: openPalette,
    state: state,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
