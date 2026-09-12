/**
 * Live localhost-style project preview (blob-served iframe + console capture).
 */
(function () {
  "use strict";

  var activeUrls = [];
  var lastRuntimeErrors = [];

  function $(id) {
    return document.getElementById(id);
  }

  function revokeAll() {
    activeUrls.forEach(function (u) {
      try {
        URL.revokeObjectURL(u);
      } catch (e) {
        /* ignore */
      }
    });
    activeUrls = [];
  }

  function ensureModal() {
    var modal = $("live-preview-modal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "live-preview-modal";
    modal.className = "live-preview-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML =
      '<div class="live-preview-card">' +
      '  <div class="live-preview-bar">' +
      '    <div class="live-preview-url" id="live-preview-url"></div>' +
      '    <div class="live-preview-actions">' +
      '      <button type="button" class="btn" id="live-preview-reload">Reload</button>' +
      '      <button type="button" class="btn" id="live-preview-fix">Ask agent to fix</button>' +
      '      <button type="button" class="btn" id="live-preview-close">Close</button>' +
      "    </div>" +
      "  </div>" +
      '  <div class="live-preview-body">' +
      '    <iframe id="live-preview-frame" title="Live project preview" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-pointer-lock"></iframe>' +
      '    <aside class="live-preview-console" id="live-preview-console" aria-label="Preview console"></aside>' +
      "  </div>" +
      "</div>";
    document.body.appendChild(modal);
    $("live-preview-close").addEventListener("click", close);
    $("live-preview-reload").addEventListener("click", function () {
      if (window.ChatrePreview && window.ChatrePreview._last) {
        open(window.ChatrePreview._last);
      }
    });
    $("live-preview-fix").addEventListener("click", function () {
      askAgentToFix();
    });
    modal.addEventListener("click", function (e) {
      if (e.target === modal) close();
    });
    window.addEventListener("message", onFrameMessage);
    return modal;
  }

  function onFrameMessage(ev) {
    var data = ev && ev.data;
    if (!data || data.type !== "chatre-preview-error") return;
    lastRuntimeErrors.push({
      severity: "error",
      path: data.source || "runtime",
      message: String(data.message || "Runtime error"),
      stack: data.stack || "",
    });
    renderConsole(
      (window.ChatrePreview._last && window.ChatrePreview._last.staticErrors) ||
        [],
      lastRuntimeErrors,
    );
    if (window.ChatreKit && window.ChatreKit.toast) {
      window.ChatreKit.toast("Preview runtime error detected", "warn");
    }
  }

  function injectProbe(html) {
    var probe =
      "<script>(function(){function send(msg,src,stack){try{parent.postMessage({type:'chatre-preview-error',message:String(msg||''),source:String(src||''),stack:String(stack||'')},'*');}catch(e){}}window.onerror=function(m,s,l,c,e){send(m,s,(e&&e.stack)||('line '+l));};window.addEventListener('unhandledrejection',function(ev){var r=ev.reason;send((r&&r.message)||r,'unhandledrejection',(r&&r.stack)||'');});})();<\/script>";
    if (/<head[^>]*>/i.test(html)) {
      return html.replace(/<head[^>]*>/i, function (m) {
        return m + probe;
      });
    }
    return probe + html;
  }

  function buildBlobMap(files) {
    var map = {};
    Object.keys(files || {}).forEach(function (rel) {
      var f = files[rel];
      var content = f && f.content != null ? f.content : f;
      var mime =
        (f && f.mime) ||
        (/\.css$/i.test(rel)
          ? "text/css"
          : /\.js$/i.test(rel)
            ? "text/javascript"
            : /\.html?/i.test(rel)
              ? "text/html"
              : "text/plain");
      var blob = new Blob([String(content || "")], { type: mime });
      var url = URL.createObjectURL(blob);
      activeUrls.push(url);
      map[rel.replace(/^\.\//, "")] = url;
    });
    return map;
  }

  function rewriteHtml(html, blobMap, entryRel) {
    var baseDir = String(entryRel || "index.html").replace(/[^/]+$/, "");
    function resolve(ref) {
      var clean = String(ref || "").split("?")[0].split("#")[0];
      if (!clean || /^(https?:|data:|blob:|#|mailto:)/i.test(clean)) return null;
      clean = clean.replace(/^\.\//, "");
      var candidates = [clean, baseDir + clean, clean.replace(/^\//, "")];
      for (var i = 0; i < candidates.length; i++) {
        if (blobMap[candidates[i]]) return blobMap[candidates[i]];
      }
      return null;
    }
    return String(html || "").replace(
      /(src|href)\s*=\s*(["'])([^"']+)\2/gi,
      function (_m, attr, q, ref) {
        var url = resolve(ref);
        if (!url) return attr + "=" + q + ref + q;
        return attr + "=" + q + url + q;
      },
    );
  }

  function renderConsole(staticErrors, runtimeErrors) {
    var el = $("live-preview-console");
    if (!el) return;
    var rows = []
      .concat(staticErrors || [])
      .concat(runtimeErrors || []);
    if (!rows.length) {
      el.innerHTML =
        '<div class="lp-ok">No errors detected yet. Interact with the preview to smoke-test.</div>';
      return;
    }
    el.innerHTML = rows
      .map(function (e) {
        return (
          '<div class="lp-err"><strong>' +
          escapeHtml(e.path || "error") +
          "</strong> " +
          escapeHtml(e.message || "") +
          "</div>"
        );
      })
      .join("");
  }

  function escapeHtml(t) {
    return String(t || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function open(payload) {
    var p = payload || {};
    var preview = p.preview || p;
    if (!preview || !preview.files) {
      if (window.ChatreKit && window.ChatreKit.toast) {
        window.ChatreKit.toast("Preview has no files", "warn");
      }
      return Promise.resolve({ ok: false, errors: [{ message: "No files" }] });
    }

    ensureModal();
    revokeAll();
    lastRuntimeErrors = [];
    window.ChatrePreview._last = {
      preview: preview,
      staticErrors: p.errors || preview.errors || [],
      ok: p.ok !== false,
      path: p.path || preview.root,
    };

    var modal = $("live-preview-modal");
    modal.classList.add("open");
    var urlEl = $("live-preview-url");
    if (urlEl) {
      urlEl.textContent =
        preview.url ||
        "http://localhost:" + (preview.port || 4173) + "/" + (preview.entry || "");
    }

    var blobMap = buildBlobMap(preview.files);
    var entry = preview.entry || "index.html";
    var entryFile = preview.files[entry];
    var html =
      entryFile && entryFile.content != null
        ? String(entryFile.content)
        : typeof entryFile === "string"
          ? entryFile
          : "<!doctype html><title>Empty</title><p>No entry HTML</p>";
    html = injectProbe(rewriteHtml(html, blobMap, entry));
    var pageBlob = new Blob([html], { type: "text/html; charset=utf-8" });
    var pageUrl = URL.createObjectURL(pageBlob);
    activeUrls.push(pageUrl);
    var frame = $("live-preview-frame");
    frame.src = pageUrl;

    // Open browser panel as a secondary surface
    if (window.ChatrePanels && window.ChatrePanels.togglePanel) {
      var shell = document.querySelector(".app-shell");
      if (shell && shell.classList.contains("hide-browser")) {
        try {
          window.ChatrePanels.togglePanel("browser");
        } catch (e) {
          /* ignore */
        }
      }
    }
    if (window.ChatreUIAdv && window.ChatreUIAdv.setBrowserPane) {
      window.ChatreUIAdv.setBrowserPane({
        url: preview.url,
        note: "Live preview · port " + (preview.port || "?"),
        open: true,
      });
    }

    renderConsole(window.ChatrePreview._last.staticErrors, []);

    return new Promise(function (resolve) {
      setTimeout(function () {
        var runtime = lastRuntimeErrors.slice();
        var staticErrs = window.ChatrePreview._last.staticErrors || [];
        var all = staticErrs.concat(runtime);
        renderConsole(staticErrs, runtime);
        resolve({
          ok: all.length === 0,
          errors: all,
          localhost: preview.url,
          port: preview.port,
        });
      }, 1600);
    });
  }

  function close() {
    var modal = $("live-preview-modal");
    if (modal) modal.classList.remove("open");
    var frame = $("live-preview-frame");
    if (frame) frame.src = "about:blank";
    revokeAll();
  }

  function askAgentToFix() {
    var last = window.ChatrePreview._last || {};
    var errs = []
      .concat(last.staticErrors || [])
      .concat(lastRuntimeErrors || []);
    var prompt =
      "Live preview found issues in " +
      (last.path || "the project") +
      ". Fix them with patch_file/write_file, then call preview_project again.\n\n" +
      (errs.length
        ? errs
            .slice(0, 12)
            .map(function (e) {
              return "- [" + (e.path || "?") + "] " + (e.message || "");
            })
            .join("\n")
        : "- Interactively verify the UI still works.");
    if (window.ChatreUI && window.ChatreUI.composeAndSend) {
      window.ChatreUI.composeAndSend(prompt);
    }
  }

  function handleAgentEvent(ev) {
    if (!ev) return;
    if (ev.type === "preview") {
      open({
        preview: ev.preview,
        errors: ev.errors || [],
        ok: ev.ok,
        path: ev.path,
      });
      return;
    }
    if (
      ev.type === "tool_result" &&
      (ev.tool === "preview_project" ||
        (ev.result && ev.result.tool === "preview_project"))
    ) {
      var r = ev.result || {};
      if (r.preview) {
        open({
          preview: r.preview,
          errors: r.errors || [],
          ok: r.ok,
          path: r.path,
        });
      }
    }
  }

  window.ChatrePreview = {
    open: open,
    close: close,
    handleAgentEvent: handleAgentEvent,
    askAgentToFix: askAgentToFix,
    getRuntimeErrors: function () {
      return lastRuntimeErrors.slice();
    },
    _last: null,
  };
})();
