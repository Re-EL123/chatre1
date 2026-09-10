/**
 * Chatre frontend — streaming chat, abort, markdown, image via /api/generate-image, slash suggestions, highlight.js, token trimming, chips.
 */

(function () {
  "use strict";

  const MAX_CONTEXT_TOKENS = 6000;
  const DEFAULT_MAX_TOKENS = 2048;

  const chatMessages = document.getElementById("chat-messages");
  const userInput = document.getElementById("user-input");
  const sendButton = document.getElementById("send-button");
  const stopButton = document.getElementById("stop-button");
  const typingIndicator = document.getElementById("typing-indicator");
  const modelSelect = document.getElementById("model-select");
  const imageModeButton = document.getElementById("image-mode-button");
  const slashSuggestions = document.getElementById("slash-suggestions");
  const chatContainer = document.querySelector(".chat-container");

  const greetings = [
    "Hey there! How can I assist you today?",
    "Hi! Ready to chat?",
    "Hello! What can I do for you?",
    "Welcome! Ask me anything — or use /image for pictures.",
    "Greetings! I'm Chatre.",
  ];

  const SLASH_COMMANDS = [
    { cmd: "/image", desc: "Generate an AI image from a prompt", action: (arg) => generateImage(arg || "A futuristic city skyline") },
    { cmd: "/clear", desc: "Clear chat history and terminal", action: () => { chatHistory = []; chatMessages.innerHTML = ""; if (xtermTerminal) xtermTerminal.clear(); showGreeting(); } },
    { cmd: "/help", desc: "Show help and available commands", action: () => addMessage("assistant", "Available commands:\n- `/image <prompt>`: Generate an AI image\n- `/clear`: Reset chat history\n- `/help`: Show this help message\n- `/model`: Show active model\n- `/terminal`: Toggle terminal panel\n- `/run <cmd>`: Run a shell command\n- `/exec <js>`: Execute JavaScript\n- `/python <code>`: Execute Python") },
    { cmd: "/model", desc: "Show current model info", action: () => addMessage("assistant", "Current active model: `" + modelSelect.value + "`") },
    { cmd: "/terminal", desc: "Toggle terminal panel", action: () => toggleTerminal() },
    { cmd: "/run", desc: "Run a shell command", action: (arg) => runShellCommand(arg) },
    { cmd: "/exec", desc: "Execute JavaScript code", action: (arg) => execJS(arg) },
    { cmd: "/python", desc: "Execute Python code", action: (arg) => execPython(arg) },
  ];

  /** @type {{ role: string, content: string }[]} */
  let chatHistory = [];
  let isProcessing = false;
  let imageMode = false;
  /** @type {AbortController | null} */
  let activeAbort = null;
  let thinkingTimer = null;
  let selectedSlashIndex = 0;

  // Terminal state
  let terminalReady = false;
  let xtermTerminal = null;
  let fitAddon = null;
  let currentDir = "/home/user";
  let pyodide = null;
  let pyodideLoading = false;

  // Virtual filesystem
  const fileSystem = {
    "/": { type: "dir", children: ["home", "tmp", "etc"] },
    "/home": { type: "dir", children: ["user"] },
    "/home/user": { type: "dir", children: ["documents", "scripts", "readme.txt"] },
    "/home/user/documents": { type: "dir", children: [] },
    "/home/user/scripts": { type: "dir", children: ["hello.js", "hello.py"] },
    "/home/user/readme.txt": { type: "file", content: "Welcome to Chatre Terminal!\nThis is a virtual filesystem.\nType 'help' for available commands." },
    "/home/user/scripts/hello.js": { type: "file", content: 'console.log("Hello from Chatre!");' },
    "/home/user/scripts/hello.py": { type: "file", content: 'print("Hello from Chatre!")' },
    "/tmp": { type: "dir", children: [] },
    "/etc": { type: "dir", children: [] },
  };

  if (window.marked) {
    marked.setOptions({
      gfm: true,
      breaks: true,
    });
  }

  function authHeaders() {
    /** @type {Record<string, string>} */
    const headers = { "Content-Type": "application/json" };
    const key =
      window.CHATRE_KEY ||
      localStorage.getItem("chatre_key") ||
      "";
    if (key) {
      headers.Authorization = "Bearer " + key;
      headers["x-chatre-key"] = key;
    }
    return headers;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderMarkdown(text) {
    const raw = String(text || "");
    if (window.marked && window.DOMPurify) {
      const html = marked.parse(raw);
      return DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        ADD_TAGS: ["img", "a"],
        ADD_ATTR: ["target", "rel", "class", "src", "alt", "width", "height", "href", "download"],
        ALLOWED_URI_REGEXP: /^(?:(?:https?|ftp|file|data|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
      });
    }
    return "<p>" + escapeHtml(raw).replace(/\n/g, "<br>") + "</p>";
  }

  function enhanceCodeBlocks(root) {
    root.querySelectorAll("pre").forEach((pre) => {
      const code = pre.querySelector("code");
      if (code && window.hljs) {
        try {
          hljs.highlightElement(code);
        } catch {
          /* ignore */
        }
      }
      if (pre.querySelector(".code-copy")) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "code-copy";
      btn.textContent = "Copy";
      btn.addEventListener("click", async () => {
        const val = code ? code.textContent : pre.textContent;
        try {
          await navigator.clipboard.writeText(val || "");
          btn.textContent = "Copied";
          setTimeout(() => {
            btn.textContent = "Copy";
          }, 1200);
        } catch {
          btn.textContent = "Failed";
          setTimeout(() => {
            btn.textContent = "Copy";
          }, 1200);
        }
      });
      pre.appendChild(btn);
    });
  }

  function appendSuggestionChips(container, text) {
    if (container.querySelector(".suggestion-chips")) return;
    const chipsDiv = document.createElement("div");
    chipsDiv.className = "suggestion-chips";

    let suggestions = ["Can you elaborate?", "Give a practical example", "Summarize key points", "Generate an image"];
    const lower = text.toLowerCase();
    if (lower.includes("code") || lower.includes("function") || lower.includes("script")) {
      suggestions = ["Explain how this code works", "Write unit tests for this", "Optimize this code", "Suggest alternative approach"];
    } else if (lower.includes("error") || lower.includes("issue")) {
      suggestions = ["How do I fix this error?", "Show debugging steps", "Explain why this happens"];
    }

    suggestions.forEach((s) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "suggestion-chip";
      chip.textContent = s;
      chip.addEventListener("click", () => {
        userInput.value = s;
        userInput.style.height = "auto";
        userInput.style.height = Math.min(userInput.scrollHeight, 160) + "px";
        userInput.focus();
      });
      chipsDiv.appendChild(chip);
    });

    container.appendChild(chipsDiv);
  }

  function setBusy(busy) {
    isProcessing = busy;
    sendButton.disabled = busy;
    userInput.disabled = busy;
    if (chatContainer) {
      chatContainer.classList.toggle("processing", busy);
    }
    if (busy) {
      stopButton.classList.add("visible");
    } else {
      stopButton.classList.remove("visible");
      activeAbort = null;
    }
  }

  function startThinking(label) {
    typingIndicator.innerHTML = '<span class="spinner"></span>' + escapeHtml(label || "Chatre is thinking…");
    typingIndicator.classList.add("visible");
    let dots = "";
    clearInterval(thinkingTimer);
    thinkingTimer = setInterval(() => {
      dots = dots.length >= 3 ? "" : dots + ".";
      typingIndicator.innerHTML = '<span class="spinner"></span>' + escapeHtml((label || "Chatre is thinking") + dots);
    }, 450);
  }

  function stopThinking() {
    clearInterval(thinkingTimer);
    thinkingTimer = null;
    typingIndicator.classList.remove("visible");
    typingIndicator.textContent = "";
  }

  function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function addMessage(role, content, options = {}) {
    const el = document.createElement("div");
    el.className = `message ${role}-message`;
    if (options.streaming) el.classList.add("streaming");

    if (options.html) {
      el.innerHTML = DOMPurify
        ? DOMPurify.sanitize(content, {
            USE_PROFILES: { html: true },
            ADD_TAGS: ["img", "a"],
            ADD_ATTR: ["src", "alt", "class", "width", "height", "href", "download"],
            ALLOWED_URI_REGEXP: /^(?:(?:https?|ftp|file|data|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
          })
        : content;
    } else if (role === "assistant") {
      el.innerHTML = renderMarkdown(content);
      enhanceCodeBlocks(el);
      appendSuggestionChips(el, content);
    } else {
      el.innerHTML = "<p>" + escapeHtml(content) + "</p>";
    }

    chatMessages.appendChild(el);
    scrollToBottom();
    return el;
  }

  function updateAssistantMessage(el, text, streaming) {
    el.innerHTML = renderMarkdown(text);
    enhanceCodeBlocks(el);
    el.classList.toggle("streaming", !!streaming);
    if (!streaming && text) {
      appendSuggestionChips(el, text);
    }
    scrollToBottom();
  }

  function estimateTokens(text) {
    return Math.ceil(String(text || "").length / 4);
  }

  function trimHistory() {
    let total = 0;
    const kept = [];
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      const msg = chatHistory[i];
      const t = estimateTokens(msg.content) + 4;
      if (total + t > MAX_CONTEXT_TOKENS && kept.length > 0) {
        break;
      }
      total += t;
      kept.unshift(msg);
    }
    chatHistory = kept;
  }

  function parseImageCommand(message) {
    const trimmed = message.trim();
    const match = trimmed.match(/^\/image\s+([\s\S]+)$/i);
    if (match) return match[1].trim();
    if (imageMode) return trimmed;

    const nlPatterns = [
      /^(?:please\s+)?(?:generate|create|make|render)\s+(?:an?\s+)?image\s+(?:of\s+)?([\s\S]+)$/i,
      /^(?:please\s+)?draw\s+(?:an?\s+)?([\s\S]+)$/i,
      /^(?:please\s+)?paint\s+(?:an?\s+)?([\s\S]+)$/i,
      /^(?:please\s+)?show\s+me\s+(?:an?\s+)?(?:picture|image)\s+of\s+([\s\S]+)$/i,
    ];

    for (const pattern of nlPatterns) {
      const m = trimmed.match(pattern);
      if (m && m[1]) {
        return m[1].trim();
      }
    }

    return null;
  }

  function showGreeting() {
    const text = greetings[Math.floor(Math.random() * greetings.length)];
    addMessage("assistant", text);
  }

  function extractStreamTokens(chunk, carry) {
    const combined = carry + chunk;
    const lines = combined.split("\n");
    const nextCarry = lines.pop() || "";
    let text = "";

    for (let line of lines) {
      line = line.trim();
      if (!line || line === "data: [DONE]" || line === "[DONE]") continue;
      if (line.startsWith("data:")) {
        line = line.slice(5).trim();
      }
      if (!line || line === "[DONE]") continue;
      try {
        const json = JSON.parse(line);
        if (typeof json.response === "string") text += json.response;
        else if (typeof json.text === "string") text += json.text;
        else if (typeof json.token === "string") text += json.token;
      } catch {
        // ignore
      }
    }

    return { text, carry: nextCarry };
  }

  function updateSlashSuggestions(val) {
    if (!val.startsWith("/") || isProcessing) {
      slashSuggestions.style.display = "none";
      return;
    }

    const query = val.toLowerCase();
    const filtered = SLASH_COMMANDS.filter((c) => c.cmd.startsWith(query) || query === "/");

    if (filtered.length === 0) {
      slashSuggestions.style.display = "none";
      return;
    }

    selectedSlashIndex = Math.min(selectedSlashIndex, filtered.length - 1);
    slashSuggestions.innerHTML = "";

    filtered.forEach((item, idx) => {
      const div = document.createElement("div");
      div.className = "slash-suggestion-item" + (idx === selectedSlashIndex ? " active" : "");
      div.innerHTML = `<code>${escapeHtml(item.cmd)}</code><span>${escapeHtml(item.desc)}</span>`;
      div.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectSlashCommand(item);
      });
      slashSuggestions.appendChild(div);
    });

    slashSuggestions.style.display = "block";
  }

  function selectSlashCommand(item) {
    slashSuggestions.style.display = "none";
    userInput.value = item.cmd + " ";
    userInput.style.height = "auto";
    userInput.style.height = Math.min(userInput.scrollHeight, 160) + "px";
    userInput.focus();
    if (item.cmd === "/clear" || item.cmd === "/help" || item.cmd === "/model") {
      item.action();
      userInput.value = "";
    }
  }

  async function sendMessage() {
    const message = userInput.value.trim();
    if (!message || isProcessing) return;

    slashSuggestions.style.display = "none";

    const slashMatch = SLASH_COMMANDS.find((c) => message === c.cmd || message.startsWith(c.cmd + " "));
    if (slashMatch) {
      const arg = message.slice(slashMatch.cmd.length).trim();
      userInput.value = "";
      userInput.style.height = "auto";
      if (slashMatch.cmd === "/image") {
        return generateImage(arg || "A futuristic city skyline");
      }
      slashMatch.action(arg);
      return;
    }

    const imagePrompt = parseImageCommand(message);
    if (imagePrompt) {
      userInput.value = "";
      userInput.style.height = "auto";
      return generateImage(imagePrompt);
    }

    setBusy(true);
    userInput.value = "";
    userInput.style.height = "auto";

    addMessage("user", message);
    chatHistory.push({ role: "user", content: message });
    trimHistory();

    startThinking("Chatre is typing");

    const assistantEl = addMessage("assistant", "", { streaming: true });
    let responseText = "";
    activeAbort = new AbortController();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: authHeaders(),
        signal: activeAbort.signal,
        body: JSON.stringify({
          messages: chatHistory,
          stream: true,
          model: modelSelect.value,
          max_tokens: DEFAULT_MAX_TOKENS,
        }),
      });

      if (!response.ok) {
        let errMsg = "Failed to get response";
        try {
          const errBody = await response.json();
          if (errBody && errBody.error) errMsg = errBody.error;
        } catch {
          /* ignore */
        }
        throw new Error(errMsg);
      }

      if (!response.body) {
        throw new Error("Empty response");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let carry = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const parsed = extractStreamTokens(chunk, carry);
        carry = parsed.carry;
        if (parsed.text) {
          responseText += parsed.text;
          updateAssistantMessage(assistantEl, responseText, true);
        }
      }

      if (carry.trim()) {
        try {
          const maybe = JSON.parse(carry.trim());
          if (typeof maybe.response === "string" && !responseText) {
            responseText = maybe.response;
          } else {
            const parsed = extractStreamTokens(carry + "\n", "");
            if (parsed.text) responseText += parsed.text;
          }
        } catch {
          const parsed = extractStreamTokens(carry + "\n", "");
          if (parsed.text) responseText += parsed.text;
        }
      }

      updateAssistantMessage(assistantEl, responseText || "…", false);

      if (!responseText) {
        updateAssistantMessage(assistantEl, "No response from the model.", false);
      } else {
        chatHistory.push({ role: "assistant", content: responseText });
        trimHistory();
      }
    } catch (error) {
      if (error && error.name === "AbortError") {
        const partial = responseText
          ? responseText + "\n\n*(stopped)*"
          : "*(generation stopped)*";
        updateAssistantMessage(assistantEl, partial, false);
        if (responseText) {
          chatHistory.push({ role: "assistant", content: responseText });
          trimHistory();
        }
      } else {
        console.error(error);
        updateAssistantMessage(
          assistantEl,
          "Sorry — " + (error.message || "there was an error processing your request."),
          false,
        );
      }
    } finally {
      stopThinking();
      setBusy(false);
      userInput.focus();
    }
  }

  async function generateImage(prompt) {
    if (!prompt || isProcessing) return;

    setBusy(true);
    addMessage("user", "/image " + prompt);
    chatHistory.push({ role: "user", content: "[Image] " + prompt });
    trimHistory();

    startThinking("Generating image");
    activeAbort = new AbortController();

    try {
      const response = await fetch("/api/generate-image", {
        method: "POST",
        headers: authHeaders(),
        signal: activeAbort.signal,
        body: JSON.stringify({ prompt, width: 512, height: 512 }),
      });

      if (!response.ok) {
        let errMsg = "Image API failed";
        try {
          const errBody = await response.json();
          if (errBody && errBody.error) errMsg = errBody.error;
        } catch {
          /* ignore */
        }
        throw new Error(errMsg);
      }

      const contentType = response.headers.get("content-type") || "";
      let imageUrl = "";

      if (contentType.includes("application/json")) {
        const data = await response.json();
        if (!data.image_base64) throw new Error("No image in response");
        imageUrl = "data:image/png;base64," + data.image_base64;
      } else {
        const blob = await response.blob();
        imageUrl = URL.createObjectURL(blob);
      }

      const html =
        "<p>Here is your generated image:</p>" +
        '<img class="generated-image" src="' +
        imageUrl +
        '" alt="Generated image"><br>' +
        '<a href="' +
        imageUrl +
        '" download="chatre-generated-image.png" class="download-btn">Download Image</a>';
      addMessage("assistant", html, { html: true });
      chatHistory.push({
        role: "assistant",
        content: "Generated an image for: " + prompt,
      });
      trimHistory();
    } catch (err) {
      if (err && err.name === "AbortError") {
        addMessage("assistant", "Image generation stopped.");
      } else {
        console.error(err);
        addMessage(
          "assistant",
          "Image generation failed: " + (err.message || "unknown error"),
        );
      }
    } finally {
      stopThinking();
      setBusy(false);
      userInput.focus();
    }
  }

  function stopGeneration() {
    if (activeAbort) {
      activeAbort.abort();
      activeAbort = null;
    }
  }

  userInput.addEventListener("input", function () {
    this.style.height = "auto";
    this.style.height = Math.min(this.scrollHeight, 160) + "px";
    updateSlashSuggestions(this.value);
  });

  userInput.addEventListener("keydown", function (e) {
    const visible = slashSuggestions.style.display === "block";
    const items = slashSuggestions.querySelectorAll(".slash-suggestion-item");

    if (visible && items.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectedSlashIndex = (selectedSlashIndex + 1) % items.length;
        items.forEach((el, idx) => el.classList.toggle("active", idx === selectedSlashIndex));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        selectedSlashIndex = (selectedSlashIndex - 1 + items.length) % items.length;
        items.forEach((el, idx) => el.classList.toggle("active", idx === selectedSlashIndex));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const activeItem = items[selectedSlashIndex];
        if (activeItem) {
          const cmdCode = activeItem.querySelector("code").textContent;
          const match = SLASH_COMMANDS.find((c) => c.cmd === cmdCode);
          if (match) {
            selectSlashCommand(match);
          }
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        slashSuggestions.style.display = "none";
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  userInput.addEventListener("blur", () => {
    setTimeout(() => {
      slashSuggestions.style.display = "none";
    }, 200);
  });

  sendButton.addEventListener("click", sendMessage);
  stopButton.addEventListener("click", stopGeneration);

  imageModeButton.addEventListener("click", () => {
    imageMode = !imageMode;
    imageModeButton.classList.toggle("active", imageMode);
    imageModeButton.setAttribute("aria-pressed", imageMode ? "true" : "false");
    userInput.placeholder = imageMode
      ? "Describe an image to generate…"
      : "Type a message… or /image a sunset over Cape Town";
    userInput.focus();
  });

  // ── Terminal ──────────────────────────────────────────────────────

  function toggleTerminal() {
    const panel = document.getElementById("terminal-panel");
    const btn = document.getElementById("terminal-toggle");
    const visible = panel.style.display !== "none";
    panel.style.display = visible ? "none" : "flex";
    btn.classList.toggle("active", !visible);
    if (!visible && !terminalReady) {
      initTerminal();
    }
    if (!visible && xtermTerminal && fitAddon) {
      setTimeout(() => fitAddon.fit(), 50);
    }
  }

  function initTerminal() {
    if (terminalReady || !window.Terminal) return;
    const container = document.getElementById("terminal-container");
    xtermTerminal = new Terminal({
      theme: {
        background: "#0a0a12",
        foreground: "#f2f2f5",
        cursor: "#6c8cff",
        selectionBackground: "rgba(108,140,255,0.3)",
      },
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: 14,
      cursorBlink: true,
      convertEol: true,
    });
    fitAddon = new FitAddon.FitAddon();
    xtermTerminal.loadAddon(fitAddon);
    xtermTerminal.open(container);
    fitAddon.fit();

    xtermTerminal.writeln("\x1b[1;36mChatre Terminal\x1b[0m v1.0");
    xtermTerminal.writeln("Type \x1b[1mhelp\x1b[0m for commands. Shell, JS, and Python.\n");
    writePrompt();

    let currentLine = "";
    xtermTerminal.onData((data) => {
      if (data === "\r") {
        xtermTerminal.writeln("");
        const cmd = currentLine.trim();
        currentLine = "";
        if (cmd) processCommand(cmd);
        writePrompt();
      } else if (data === "\x7f") {
        if (currentLine.length > 0) {
          currentLine = currentLine.slice(0, -1);
          xtermTerminal.write("\b \b");
        }
      } else if (data === "\t") {
        const matches = getCompletions(currentLine);
        if (matches.length === 1) {
          const rest = matches[0].slice(currentLine.length);
          currentLine += rest;
          xtermTerminal.write(rest);
        } else if (matches.length > 1) {
          xtermTerminal.writeln("");
          xtermTerminal.writeln(matches.join("  "));
          writePrompt();
          xtermTerminal.write(currentLine);
        }
      } else if (data === "\x03") {
        xtermTerminal.writeln("^C");
        currentLine = "";
        writePrompt();
      } else if (data >= " " && data.length === 1) {
        currentLine += data;
        xtermTerminal.write(data);
      }
    });

    terminalReady = true;
    window.addEventListener("resize", () => {
      if (fitAddon) fitAddon.fit();
    });
  }

  function writePrompt() {
    const dir = currentDir === "/home/user" ? "~" : currentDir.replace("/home/user", "~");
    xtermTerminal.write("\x1b[36mchatre\x1b[0m:\x1b[33m" + dir + "\x1b[0m$ ");
  }

  function getCompletions(partial) {
    const parts = partial.split(/\s+/);
    const commands = ["help", "ls", "cd", "pwd", "cat", "echo", "touch", "mkdir", "rm", "clear", "js", "py", "whoami"];
    if (parts.length <= 1) {
      return commands.filter((c) => c.startsWith(parts[0]));
    }
    const dirEntries = fileSystem[currentDir];
    if (dirEntries && dirEntries.type === "dir") {
      return dirEntries.children.filter((c) => c.startsWith(parts[parts.length - 1]));
    }
    return [];
  }

  function processCommand(cmd) {
    const parts = cmd.split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1).join(" ");

    switch (command) {
      case "help":
        xtermTerminal.writeln("Available commands:");
        xtermTerminal.writeln("  help              Show this help");
        xtermTerminal.writeln("  ls [dir]          List directory contents");
        xtermTerminal.writeln("  cd <dir>          Change directory");
        xtermTerminal.writeln("  pwd               Print working directory");
        xtermTerminal.writeln("  cat <file>        Display file contents");
        xtermTerminal.writeln("  echo <text>       Print text");
        xtermTerminal.writeln("  touch <file>      Create an empty file");
        xtermTerminal.writeln("  mkdir <dir>       Create a directory");
        xtermTerminal.writeln("  rm <file>         Remove a file");
        xtermTerminal.writeln("  js <code>         Execute JavaScript");
        xtermTerminal.writeln("  py <code>         Execute Python (loads Pyodide)");
        xtermTerminal.writeln("  clear             Clear terminal");
        xtermTerminal.writeln("  whoami            Print current user");
        break;

      case "clear":
        xtermTerminal.clear();
        break;

      case "whoami":
        xtermTerminal.writeln("chatre");
        break;

      case "pwd":
        xtermTerminal.writeln(currentDir);
        break;

      case "ls": {
        const target = resolvePath(args || currentDir);
        const entry = fileSystem[target];
        if (!entry) {
          xtermTerminal.writeln("ls: cannot access '" + (args || ".") + "': No such file or directory");
        } else if (entry.type !== "dir") {
          xtermTerminal.writeln(target.split("/").pop());
        } else {
          const items = entry.children.map((name) => {
            const childPath = target === "/" ? "/" + name : target + "/" + name;
            const child = fileSystem[childPath];
            if (child && child.type === "dir") return "\x1b[1;34m" + name + "/\x1b[0m";
            if (name.endsWith(".js") || name.endsWith(".py")) return "\x1b[1;32m" + name + "\x1b[0m";
            return name;
          });
          xtermTerminal.writeln(items.join("  "));
        }
        break;
      }

      case "cd": {
        if (!args || args === "~") {
          currentDir = "/home/user";
        } else if (args === "..") {
          currentDir = currentDir === "/" ? "/" : currentDir.replace(/\/[^/]+$/, "") || "/";
        } else if (args === "/") {
          currentDir = "/";
        } else {
          const target = resolvePath(args);
          const entry = fileSystem[target];
          if (!entry) {
            xtermTerminal.writeln("cd: no such file or directory: " + args);
          } else if (entry.type !== "dir") {
            xtermTerminal.writeln("cd: not a directory: " + args);
          } else {
            currentDir = target;
          }
        }
        break;
      }

      case "cat": {
        if (!args) {
          xtermTerminal.writeln("cat: missing file operand");
        } else {
          const target = resolvePath(args);
          const entry = fileSystem[target];
          if (!entry) {
            xtermTerminal.writeln("cat: " + args + ": No such file or directory");
          } else if (entry.type === "dir") {
            xtermTerminal.writeln("cat: " + args + ": Is a directory");
          } else {
            xtermTerminal.writeln(entry.content || "");
          }
        }
        break;
      }

      case "echo":
        xtermTerminal.writeln(args);
        break;

      case "touch": {
        if (!args) {
          xtermTerminal.writeln("touch: missing file operand");
        } else {
          const target = resolvePath(args);
          const parent = target.replace(/\/[^/]+$/, "") || "/";
          const name = target.split("/").pop();
          if (!fileSystem[parent] || fileSystem[parent].type !== "dir") {
            xtermTerminal.writeln("touch: cannot create file: parent directory does not exist");
          } else if (!fileSystem[target]) {
            fileSystem[target] = { type: "file", content: "" };
            if (!fileSystem[parent].children.includes(name)) {
              fileSystem[parent].children.push(name);
            }
          }
        }
        break;
      }

      case "mkdir": {
        if (!args) {
          xtermTerminal.writeln("mkdir: missing directory operand");
        } else {
          const target = resolvePath(args);
          const parent = target.replace(/\/[^/]+$/, "") || "/";
          const name = target.split("/").pop();
          if (!fileSystem[parent] || fileSystem[parent].type !== "dir") {
            xtermTerminal.writeln("mkdir: cannot create directory: parent does not exist");
          } else if (fileSystem[target]) {
            xtermTerminal.writeln("mkdir: cannot create directory '" + args + "': File exists");
          } else {
            fileSystem[target] = { type: "dir", children: [] };
            if (!fileSystem[parent].children.includes(name)) {
              fileSystem[parent].children.push(name);
            }
          }
        }
        break;
      }

      case "rm": {
        if (!args) {
          xtermTerminal.writeln("rm: missing file operand");
        } else {
          const target = resolvePath(args);
          const parent = target.replace(/\/[^/]+$/, "") || "/";
          const name = target.split("/").pop();
          if (!fileSystem[target]) {
            xtermTerminal.writeln("rm: cannot remove '" + args + "': No such file or directory");
          } else if (fileSystem[target].type === "dir" && fileSystem[target].children.length > 0) {
            xtermTerminal.writeln("rm: cannot remove '" + args + "': Directory not empty");
          } else {
            delete fileSystem[target];
            if (fileSystem[parent]) {
              fileSystem[parent].children = fileSystem[parent].children.filter((c) => c !== name);
            }
          }
        }
        break;
      }

      case "js": {
        if (!args) {
          xtermTerminal.writeln("js: usage: js <code>");
        } else {
          try {
            const result = new Function("return (" + args + ")")();
            if (result !== undefined) xtermTerminal.writeln(String(result));
          } catch (e) {
            xtermTerminal.writeln("\x1b[31m" + (e.message || String(e)) + "\x1b[0m");
          }
        }
        break;
      }

      case "py": {
        if (!args) {
          xtermTerminal.writeln("py: usage: py <python_code>");
        } else {
          runPyodide(args);
        }
        break;
      }

      default:
        xtermTerminal.writeln("command not found: " + command);
        break;
    }
  }

  function resolvePath(path) {
    if (!path) return currentDir;
    if (path === "~") return "/home/user";
    if (path.startsWith("~/")) path = "/home/user/" + path.slice(2);
    if (!path.startsWith("/")) path = currentDir + "/" + path;
    const pathParts = path.split("/").filter(Boolean);
    const resolved = [];
    for (const p of pathParts) {
      if (p === ".") continue;
      if (p === "..") resolved.pop();
      else resolved.push(p);
    }
    return "/" + resolved.join("/") || "/";
  }

  async function runPyodide(code) {
    if (!pyodide && !pyodideLoading) {
      pyodideLoading = true;
      xtermTerminal.writeln("Loading Python runtime (Pyodide)...");
      try {
        if (!window.loadPyodide) {
          await loadScript("https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js");
        }
        pyodide = await window.loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/" });
        xtermTerminal.writeln("Python ready.\n");
      } catch (e) {
        xtermTerminal.writeln("\x1b[31mFailed to load Pyodide: " + (e.message || e) + "\x1b[0m");
        pyodideLoading = false;
        return;
      }
      pyodideLoading = false;
    }
    if (!pyodide) return;
    try {
      const result = pyodide.runPython(code);
      if (result !== undefined && result !== null) {
        xtermTerminal.writeln(String(result));
      }
    } catch (e) {
      xtermTerminal.writeln("\x1b[31m" + (e.message || String(e)) + "\x1b[0m");
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load " + src));
      document.head.appendChild(s);
    });
  }

  // ── Chat slash commands for terminal ─────────────────────────────

  function runShellCommand(cmd) {
    if (!cmd) {
      addMessage("assistant", "Usage: `/run <command>` — e.g. `/run ls -la`");
      return;
    }
    const output = executeShellCmd(cmd);
    showTerminalOutput("$ " + cmd, output, false);
  }

  function executeShellCmd(cmd) {
    const parts = cmd.split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1).join(" ");
    let output = "";

    switch (command) {
      case "ls": {
        const target = resolvePath(args || currentDir);
        const entry = fileSystem[target];
        if (!entry) output = "ls: cannot access '" + (args || ".") + "': No such file or directory";
        else if (entry.type !== "dir") output = target.split("/").pop();
        else output = entry.children.join("\n");
        break;
      }
      case "pwd":
        output = currentDir;
        break;
      case "cat": {
        if (!args) { output = "cat: missing file operand"; break; }
        const target = resolvePath(args);
        const entry = fileSystem[target];
        if (!entry) output = "cat: " + args + ": No such file or directory";
        else if (entry.type === "dir") output = "cat: " + args + ": Is a directory";
        else output = entry.content || "";
        break;
      }
      case "echo":
        output = args;
        break;
      case "whoami":
        output = "chatre";
        break;
      case "cd": {
        if (!args || args === "~") {
          currentDir = "/home/user";
          output = "";
        } else if (args === "..") {
          currentDir = currentDir === "/" ? "/" : currentDir.replace(/\/[^/]+$/, "") || "/";
          output = "";
        } else {
          const target = resolvePath(args);
          const entry = fileSystem[target];
          if (!entry) output = "cd: no such file or directory: " + args;
          else if (entry.type !== "dir") output = "cd: not a directory: " + args;
          else { currentDir = target; output = ""; }
        }
        break;
      }
      default:
        output = "command not found: " + command + "\nTry: ls, cd, pwd, cat, echo, whoami";
        break;
    }
    return output;
  }

  async function execJS(code) {
    if (!code) {
      addMessage("assistant", "Usage: `/exec <javascript>` — e.g. `/exec 2 + 2`");
      return;
    }
    try {
      const result = new Function("return (" + code + ")")();
      showTerminalOutput("js> " + code, result !== undefined ? String(result) : "(undefined)", false);
    } catch (e) {
      showTerminalOutput("js> " + code, e.message || String(e), true);
    }
  }

  async function execPython(code) {
    if (!code) {
      addMessage("assistant", "Usage: `/python <code>` — e.g. `/python print('hello')`");
      return;
    }
    if (!pyodide && !pyodideLoading) {
      pyodideLoading = true;
      addMessage("assistant", '<span class="spinner"></span>Loading Python runtime (first time, may take a moment)...', { html: true });
      try {
        if (!window.loadPyodide) {
          await loadScript("https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js");
        }
        pyodide = await window.loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/" });
      } catch (e) {
        addMessage("assistant", "Failed to load Python: " + (e.message || e));
        pyodideLoading = false;
        return;
      }
      pyodideLoading = false;
    }
    if (!pyodide) return;
    try {
      const result = pyodide.runPython(code);
      showTerminalOutput("python> " + code, result !== undefined && result !== null ? String(result) : "(no output)", false);
    } catch (e) {
      showTerminalOutput("python> " + code, e.message || String(e), true);
    }
  }

  function showTerminalOutput(title, body, isError) {
    const html =
      '<div class="terminal-output-block">' +
      '<div class="terminal-output-header"><span>' + escapeHtml(title) + "</span><span>" + (isError ? "error" : "output") + "</span></div>" +
      '<div class="terminal-output-body' + (isError ? " error" : "") + '">' + escapeHtml(body) + "</div></div>";
    addMessage("assistant", html, { html: true });
  }

  // ── Terminal event listeners ─────────────────────────────────────

  document.getElementById("terminal-toggle").addEventListener("click", toggleTerminal);
  document.getElementById("terminal-close").addEventListener("click", toggleTerminal);

  showGreeting();
})();
