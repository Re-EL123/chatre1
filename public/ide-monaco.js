/**
 * Monaco editor host for the Files/IDE panel (VS Code–style workbench).
 * Lazy-loads from CDN; exposes window.ChatreMonaco.
 */
(function () {
  "use strict";

  var MONACO_VER = "0.52.2";
  var VS =
    "https://cdn.jsdelivr.net/npm/monaco-editor@" + MONACO_VER + "/min/vs";

  var editor = null;
  var models = Object.create(null);
  var currentPath = null;
  var dirty = Object.create(null);
  var changeHandlers = [];
  var readyPromise = null;
  var hostEl = null;

  var EXT_LANG = {
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    json: "json",
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    less: "less",
    md: "markdown",
    markdown: "markdown",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    c: "c",
    h: "c",
    cpp: "cpp",
    cc: "cpp",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    yml: "yaml",
    yaml: "yaml",
    toml: "ini",
    ini: "ini",
    xml: "xml",
    svg: "xml",
    sql: "sql",
    graphql: "graphql",
    gql: "graphql",
    txt: "plaintext",
    env: "plaintext",
    dockerfile: "dockerfile",
  };

  function guessLanguage(path) {
    var base = String(path || "").split("/").pop() || "";
    if (/^dockerfile$/i.test(base)) return "dockerfile";
    var m = base.match(/\.([a-z0-9]+)$/i);
    if (!m) return "plaintext";
    return EXT_LANG[m[1].toLowerCase()] || "plaintext";
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) {
        resolve();
        return;
      }
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        reject(new Error("Failed to load " + src));
      };
      document.head.appendChild(s);
    });
  }

  function ensureReady() {
    if (readyPromise) return readyPromise;
    readyPromise = loadScript(VS + "/loader.js").then(function () {
      return new Promise(function (resolve, reject) {
        try {
          window.require.config({ paths: { vs: VS } });
          window.require(["vs/editor/editor.main"], function () {
            resolve(window.monaco);
          });
        } catch (e) {
          reject(e);
        }
      });
    });
    return readyPromise;
  }

  function getHost() {
    if (hostEl && hostEl.isConnected) return hostEl;
    hostEl = document.getElementById("monaco-editor");
    return hostEl;
  }

  function ensureEditor() {
    return ensureReady().then(function (monaco) {
      var host = getHost();
      if (!host) throw new Error("monaco-editor host missing");
      if (editor) {
        editor.layout();
        return editor;
      }
      editor = monaco.editor.create(host, {
        value: "",
        language: "plaintext",
        theme: "vs-dark",
        automaticLayout: true,
        fontSize: 13,
        fontFamily:
          "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, 'Courier New', monospace",
        fontLigatures: true,
        minimap: { enabled: true, scale: 0.75, showSlider: "mouseover" },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        renderLineHighlight: "line",
        lineNumbers: "on",
        glyphMargin: true,
        folding: true,
        bracketPairColorization: { enabled: true },
        padding: { top: 8 },
        tabSize: 2,
        wordWrap: "off",
        readOnly: false,
        contextmenu: true,
        fixedOverflowWidgets: true,
      });
      editor.onDidChangeModelContent(function () {
        if (!currentPath) return;
        dirty[currentPath] = true;
        changeHandlers.forEach(function (fn) {
          try {
            fn({ path: currentPath, dirty: true });
          } catch (e) {}
        });
      });
      editor.onDidChangeCursorSelection(function () {
        if (!window.ChatreIdeContext || !window.ChatreIdeContext.setSelection) {
          return;
        }
        var sel = editor.getSelection();
        var model = editor.getModel();
        if (!sel || !model) return;
        var text = model.getValueInRange(sel);
        window.ChatreIdeContext.setSelection(text, {
          line: sel.startLineNumber,
          column: sel.startColumn,
        }, guessLanguage(currentPath));
      });
      return editor;
    });
  }

  function modelUri(path) {
    return "chatre://" + String(path || "").replace(/^\/+/, "");
  }

  function showFile(path, content, opts) {
    opts = opts || {};
    return ensureEditor().then(function (ed) {
      var monaco = window.monaco;
      var lang = opts.language || guessLanguage(path);
      var uri = monaco.Uri.parse(modelUri(path));
      var model = models[path];
      if (!model || model.isDisposed()) {
        model = monaco.editor.createModel(
          content != null ? String(content) : "",
          lang,
          uri,
        );
        models[path] = model;
      } else if (opts.forceContent || !dirty[path]) {
        var next = content != null ? String(content) : "";
        if (model.getValue() !== next) {
          model.setValue(next);
        }
        monaco.editor.setModelLanguage(model, lang);
      }
      currentPath = path;
      ed.setModel(model);
      ed.updateOptions({ readOnly: !!opts.readOnly });
      if (opts.revealLine) {
        ed.revealLineInCenter(Number(opts.revealLine) || 1);
      }
      ed.layout();
      showHost(true);
      return ed;
    });
  }

  function updateContent(path, content) {
    var model = models[path];
    if (!model || model.isDisposed()) return;
    if (dirty[path] && path === currentPath) return;
    var next = content != null ? String(content) : "";
    if (model.getValue() !== next) model.setValue(next);
    dirty[path] = false;
  }

  function getValue(path) {
    var p = path || currentPath;
    if (p && models[p] && !models[p].isDisposed()) {
      return models[p].getValue();
    }
    if (editor) return editor.getValue();
    return "";
  }

  function isDirty(path) {
    return !!dirty[path || currentPath];
  }

  function markClean(path) {
    var p = path || currentPath;
    if (p) dirty[p] = false;
    changeHandlers.forEach(function (fn) {
      try {
        fn({ path: p, dirty: false });
      } catch (e) {}
    });
  }

  function closeModel(path) {
    var model = models[path];
    if (model && !model.isDisposed()) model.dispose();
    delete models[path];
    delete dirty[path];
    if (currentPath === path) {
      currentPath = null;
      if (editor) editor.setModel(null);
    }
  }

  function clear() {
    currentPath = null;
    if (editor) editor.setModel(null);
    showHost(false);
  }

  function showHost(on) {
    var host = getHost();
    var fallback = document.getElementById("file-viewer-fallback");
    if (host) host.hidden = !on;
    if (fallback) fallback.hidden = !!on;
  }

  function showFallback() {
    showHost(false);
  }

  function layout() {
    if (editor) editor.layout();
  }

  function onChange(fn) {
    if (typeof fn === "function") changeHandlers.push(fn);
  }

  function getSelection() {
    if (!editor) return "";
    var sel = editor.getSelection();
    var model = editor.getModel();
    if (!sel || !model) return "";
    return model.getValueInRange(sel);
  }

  function focus() {
    if (editor) editor.focus();
  }

  window.ChatreMonaco = {
    ready: ensureReady,
    ensureEditor: ensureEditor,
    showFile: showFile,
    updateContent: updateContent,
    getValue: getValue,
    isDirty: isDirty,
    markClean: markClean,
    closeModel: closeModel,
    clear: clear,
    showFallback: showFallback,
    showHost: showHost,
    layout: layout,
    onChange: onChange,
    getSelection: getSelection,
    guessLanguage: guessLanguage,
    focus: focus,
    get currentPath() {
      return currentPath;
    },
    get editor() {
      return editor;
    },
  };
})();
