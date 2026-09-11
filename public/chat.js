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
    { cmd: "/clear", desc: "Clear chat history and terminal", action: () => { chatHistory = []; chatMessages.innerHTML = ""; window.__localResumeMessages = null; window.__pendingClarification = false; window.__pendingUserInput = null; window.__pendingConnectors = null; if (window.ChatrePanels) window.ChatrePanels.setResumeAvailable(false); if (xtermTerminal) xtermTerminal.clear(); showGreeting(); } },
    { cmd: "/help", desc: "Show help and available commands", action: () => addMessage("assistant", "Available commands:\n- `/image <prompt>`: Generate an AI image\n- `/clear`: Reset chat history\n- `/help`: Show this help message\n- `/model`: Show active model\n- `/terminal`: Toggle terminal panel\n- `/run <cmd>`: Run a shell command\n- `/exec <js>`: Execute JavaScript\n- `/python <code>`: Execute Python\n- `/agent`: Toggle agent mode (ON by default — plan, build, code, commit, documents)") },
    { cmd: "/model", desc: "Show current model info", action: () => addMessage("assistant", "Current active model: `" + modelSelect.value + "`\nAgent mode: **" + (agentMode ? "ON" : "OFF") + "**") },
    { cmd: "/terminal", desc: "Toggle terminal panel", action: () => toggleTerminal() },
    { cmd: "/run", desc: "Run a shell command", action: (arg) => runShellCommand(arg) },
    { cmd: "/exec", desc: "Execute JavaScript code", action: (arg) => execJS(arg) },
    { cmd: "/python", desc: "Execute Python code", action: (arg) => execPython(arg) },
    { cmd: "/agent", desc: "Toggle agent mode (plan, build, code, commit)", action: () => toggleAgentMode() },
    { cmd: "/skills", desc: "List agent skills", action: () => {
      if (!window.ChatreSkills) return addMessage("assistant", "Skills module not loaded.");
      const list = window.ChatreSkills.listSkills().map((s) => "- **" + s.name + "**: " + s.summary).join("\n");
      addMessage("assistant", "Available skills:\n" + list);
    } },
  ];

  /** @type {{ role: string, content: string }[]} */
  let chatHistory = [];
  let isProcessing = false;
  let imageMode = false;
  /** @type {AbortController | null} */
  let activeAbort = null;
  let thinkingTimer = null;
  let selectedSlashIndex = 0;
  let agentMode = true;

  // Agent workspace / git state
  const gitState = { initialized: false, branch: "main", staged: new Set(), commits: [] };

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

  /** Send a string through the normal chat pipeline (used by chips/buttons). */
  function submitChoice(text) {
    if (isProcessing) return;
    userInput.value = String(text || "");
    userInput.style.height = "auto";
    sendMessage();
  }

  /** Render tappable option buttons from an ask_user_input result. */
  function renderOptionButtons(container, payload) {
    if (!payload || !Array.isArray(payload.options) || !payload.options.length) {
      return;
    }
    const box = document.createElement("div");
    box.className = "ask-user-prompt";
    const q = document.createElement("div");
    q.className = "ask-question";
    q.textContent = payload.question || "Please choose:";
    box.appendChild(q);
    const btns = document.createElement("div");
    btns.className = "option-buttons";
    payload.options.forEach((opt) => {
      const label = opt.label || opt.value || String(opt);
      const value = opt.value || label;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "option-button";
      b.textContent = label;
      b.addEventListener("click", () => submitChoice(value));
      btns.appendChild(b);
    });
    box.appendChild(btns);
    container.appendChild(box);
    scrollToBottom();
  }

  /** Render connector cards from a suggest_connectors result. */
  function renderConnectorCards(container, payload) {
    if (!payload || !Array.isArray(payload.connectors) || !payload.connectors.length) {
      return;
    }
    const prompt = document.createElement("div");
    prompt.className = "connector-prompt";
    if (payload.question) {
      const q = document.createElement("div");
      q.className = "ask-question";
      q.textContent = payload.question;
      prompt.appendChild(q);
    }
    let connectedUuids = [];
    if (window.ChatreMCP) {
      connectedUuids = window.ChatreMCP.listConnected().map((c) => c.uuid);
    }
    payload.connectors.forEach((c) => {
      const card = document.createElement("div");
      card.className = "connector-card";
      const nameEl = document.createElement("div");
      nameEl.className = "connector-name";
      nameEl.textContent = c.name || c.uuid;
      const descEl = document.createElement("div");
      descEl.className = "connector-desc";
      descEl.textContent = c.description || "";
      card.appendChild(nameEl);
      card.appendChild(descEl);

      const actions = document.createElement("div");
      actions.className = "connector-actions";
      const statusEl = document.createElement("span");
      statusEl.className = "connector-state";

      const mkBtn = (label, cls, fn) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = cls;
        b.textContent = label;
        b.addEventListener("click", fn);
        return b;
      };

      const useBtn = mkBtn("Use", "use-btn", () =>
        submitChoice("Use " + (c.name || c.uuid) + " (" + c.uuid + ")"),
      );

      const alreadyConnected = connectedUuids.indexOf(c.uuid) !== -1;
      if (alreadyConnected) {
        statusEl.textContent = "connected";
        actions.appendChild(useBtn);
      } else {
        const connectBtn = mkBtn("Connect", "connect-btn", () => {
          if (window.ChatreMCP) window.ChatreMCP.connect(c.uuid);
          statusEl.textContent = "connected";
          actions.replaceChild(useBtn, connectBtn);
        });
        actions.appendChild(connectBtn);
      }
      actions.appendChild(
        mkBtn("None of these", "none-btn", () =>
          submitChoice("None of these connectors"),
        ),
      );

      card.appendChild(statusEl);
      card.appendChild(actions);
      prompt.appendChild(card);
    });
    container.appendChild(prompt);
    scrollToBottom();
  }

  function setBusy(busy, mode) {
    isProcessing = busy;
    sendButton.disabled = busy;
    userInput.disabled = busy;
    document.body.classList.toggle("is-working", busy);
    if (chatContainer) {
      chatContainer.classList.toggle("processing", busy);
      chatContainer.classList.toggle("imaging", busy && mode === "image");
      chatContainer.classList.toggle("agenting", busy && mode === "agent");
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
    if (!slashSuggestions) return;
    if (!val.startsWith("/") || isProcessing || /\s/.test(val)) {
      slashSuggestions.style.display = "none";
      return;
    }

    const query = val.toLowerCase();
    const filtered = SLASH_COMMANDS.filter(
      (c) => query === "/" || c.cmd.startsWith(query),
    );

    if (filtered.length === 0) {
      slashSuggestions.style.display = "none";
      return;
    }

    if (selectedSlashIndex >= filtered.length) selectedSlashIndex = 0;
    slashSuggestions.innerHTML = "";

    filtered.forEach((item, idx) => {
      const div = document.createElement("div");
      div.className =
        "slash-suggestion-item" + (idx === selectedSlashIndex ? " active" : "");
      div.setAttribute("role", "option");
      div.setAttribute("aria-selected", idx === selectedSlashIndex ? "true" : "false");
      const code = document.createElement("code");
      code.textContent = item.cmd;
      const span = document.createElement("span");
      span.textContent = item.desc;
      div.appendChild(code);
      div.appendChild(span);
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

    if (window.ChatreUIAdv && window.ChatreUIAdv.hideStarterChips) {
      window.ChatreUIAdv.hideStarterChips();
    }
    const empty = chatMessages && chatMessages.querySelector(".empty-state");
    if (empty) empty.remove();

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

    // ── Intent-aware routing ─────────────────────────────────────
    const intentInfo =
      window.ChatreIntent && window.ChatreIntent.classifyIntent
        ? window.ChatreIntent.classifyIntent(message)
        : null;

    // If the agent asked a clarifying question OR showed tappable option
    // buttons / connector cards last turn, the next message is the user's
    // answer/choice — resume the existing thread automatically.
    let resumeBecauseClarification = false;
    const hadPendingChoice =
      window.__pendingUserInput || window.__pendingConnectors;
    if (
      hadPendingChoice ||
      (window.__pendingClarification && window.__localResumeMessages)
    ) {
      resumeBecauseClarification = true;
      window.__pendingClarification = false;
      window.__pendingUserInput = null;
      window.__pendingConnectors = null;
    }

    const stashed = window.__localResumeMessages;
    const continueIntent =
      stashed &&
      /^\s*(?:continue|resume|keep going|keep working|go on|proceed|carry on|pick up|finish it|finish)\b/i.test(
        message,
      );
    const wantsAgent =
      window.ChatreAgent && window.ChatreTools &&
      (agentMode ||
        resumeBecauseClarification ||
        (intentInfo && intentInfo.suggestsWeb && intentInfo.name !== "chat") ||
        window.ChatreAgent.looksAgentic(message));
    // Short greetings and knowledge-only questions get a fast plain-chat
    // answer — no agent loop, no tools, no "planning" indicator.
    const fastChat =
      !wantsAgent &&
      window.ChatreAgent &&
      intentInfo &&
      !resumeBecauseClarification &&
      (intentInfo.name === "chat" ||
        (intentInfo.name === "question" && !intentInfo.suggestsWeb));

    if (wantsAgent && window.ChatreAgent && window.ChatreTools) {
      userInput.value = "";
      userInput.style.height = "auto";
      return runAgentTask(message, {
        resumeMessages: resumeBecauseClarification || continueIntent ? stashed : null,
      });
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

      // Strip any tool-call blocks from non-agent responses for clean display
      if (window.ChatreTools && /```(?:tool|tool_call|agent)\b/.test(responseText)) {
        responseText = window.ChatreTools.cleanResponseText(responseText);
        updateAssistantMessage(assistantEl, responseText || "…", false);
      }

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

  /**
   * Build an image message with real DOM nodes so blob:/data: URLs are never
   * stripped by DOMPurify (which was why only "Generated image" text appeared).
   */
  function addGeneratedImageMessage(imageUrl, prompt) {
    const el = document.createElement("div");
    el.className = "message assistant-message";

    const caption = document.createElement("p");
    caption.textContent = "Here is your generated image:";
    el.appendChild(caption);

    const card = document.createElement("div");
    card.className = "image-gen-card";

    const img = document.createElement("img");
    img.className = "generated-image";
    img.alt = prompt ? "Generated image: " + prompt : "Generated image";
    img.decoding = "async";
    img.onload = () => {
      img.classList.add("loaded");
      scrollToBottom();
    };
    img.onerror = () => {
      caption.textContent = "Image generated, but it failed to display in the browser.";
      img.remove();
    };
    img.src = imageUrl;
    card.appendChild(img);

    const download = document.createElement("a");
    download.className = "download-btn";
    download.href = imageUrl;
    download.download = "chatre-" + Date.now() + ".png";
    download.textContent = "Download Image";
    card.appendChild(download);

    el.appendChild(card);
    chatMessages.appendChild(el);
    scrollToBottom();
    return el;
  }

  function showImagePlaceholder(prompt) {
    const el = document.createElement("div");
    el.className = "message assistant-message";
    el.dataset.imagePlaceholder = "1";

    const caption = document.createElement("p");
    caption.textContent = "Painting your image…";
    el.appendChild(caption);

    const card = document.createElement("div");
    card.className = "image-gen-card";
    const skeleton = document.createElement("div");
    skeleton.className = "image-skeleton";
    skeleton.innerHTML =
      '<div class="orbit" aria-hidden="true"></div>' +
      "<span>" +
      escapeHtml(prompt.length > 60 ? prompt.slice(0, 57) + "…" : prompt) +
      "</span>";
    card.appendChild(skeleton);
    el.appendChild(card);
    chatMessages.appendChild(el);
    scrollToBottom();
    return el;
  }

  async function generateImage(prompt) {
    if (!prompt || isProcessing) return;

    setBusy(true, "image");
    addMessage("user", "/image " + prompt);
    chatHistory.push({ role: "user", content: "[Image] " + prompt });
    trimHistory();

    startThinking("Generating image");
    const placeholder = showImagePlaceholder(prompt);
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

      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      let imageUrl = "";

      if (contentType.includes("application/json")) {
        const data = await response.json();
        const raw = data.image_base64 || data.image || "";
        if (!raw) throw new Error("No image in response");
        imageUrl = String(raw).startsWith("data:")
          ? String(raw)
          : "data:image/png;base64," + raw;
      } else {
        const blob = await response.blob();
        if (!blob || blob.size === 0) {
          throw new Error("Empty image response");
        }
        // Prefer data URL so the image survives refresh within the session and
        // never depends on blob: being allowed through sanitizers.
        imageUrl = await blobToDataUrl(blob);
      }

      placeholder.remove();
      addGeneratedImageMessage(imageUrl, prompt);
      chatHistory.push({
        role: "assistant",
        content: "Generated an image for: " + prompt,
      });
      trimHistory();
    } catch (err) {
      placeholder.remove();
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

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read image data"));
      reader.readAsDataURL(blob);
    });
  }

  function toggleAgentMode(force) {
    agentMode = typeof force === "boolean" ? force : !agentMode;
    const btn = document.getElementById("agent-mode-button");
    if (btn) {
      btn.classList.toggle("active", agentMode);
      btn.setAttribute("aria-pressed", agentMode ? "true" : "false");
    }
    addMessage(
      "assistant",
      agentMode
        ? "Agent mode **ON**. I will plan, use skills, build code, create documents, run commands, verify, and commit/push when needed."
        : "Agent mode **OFF**. Normal chat — I still auto-activate for build/code tasks.",
    );
    userInput.focus();
  }

  function stopGeneration() {
    if (window.ChatreAgent && window.ChatreAgent.isRunning()) {
      window.ChatreAgent.stop();
    }
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

  const agentModeButton = document.getElementById("agent-mode-button");
  if (agentModeButton) {
    agentModeButton.classList.toggle("active", agentMode);
    agentModeButton.setAttribute("aria-pressed", agentMode ? "true" : "false");
    agentModeButton.addEventListener("click", () => {
      toggleAgentMode();
    });
  }

  const apiKeyInput = document.getElementById("api-key-input");
  if (apiKeyInput) {
    apiKeyInput.value =
      localStorage.getItem("chatre_api_key") ||
      window.CHATRE_API_KEY ||
      "";
    const persistKey = () => {
      const v = apiKeyInput.value.trim();
      if (v) {
        localStorage.setItem("chatre_api_key", v);
        window.CHATRE_API_KEY = v;
      } else {
        localStorage.removeItem("chatre_api_key");
        window.CHATRE_API_KEY = "";
      }
    };
    apiKeyInput.addEventListener("change", persistKey);
    apiKeyInput.addEventListener("blur", persistKey);
    apiKeyInput.addEventListener("input", persistKey);
  }

  function showGreeting() {
    chatMessages.innerHTML = "";
    if (window.ChatreUIAdv && window.ChatreUIAdv.showStarterChips) {
      window.ChatreUIAdv.showStarterChips();
    }
    if (window.ChatreUIAdv && window.ChatreUIAdv.renderEmptyState) {
      window.ChatreUIAdv.renderEmptyState(chatMessages);
      return;
    }
    const text = agentMode
      ? "Hello! I'm Chatre — agent mode is on. Ask me to plan, build code, create documents, run commands, or commit."
      : greetings[Math.floor(Math.random() * greetings.length)];
    addMessage("assistant", text);
  }

  // ── Agentic mode ──────────────────────────────────────────────────

  async function runAgentTask(message, opts) {
    opts = opts || {};
    setBusy(true, "agent");
    if (!opts.resumeMessages) {
      // Starting fresh (or a brand-new task): discard any stale resume state.
      window.__localResumeMessages = null;
      if (window.ChatrePanels) window.ChatrePanels.setResumeAvailable(false);
    }
    if (message) {
      addMessage("user", message);
      chatHistory.push({ role: "user", content: message });
      trimHistory();
    }

    startThinking("Chatre is planning");

    const agentBody = document.createElement("div");
    agentBody.className = "agent-body";
    const agentEl = document.createElement("div");
    agentEl.className = "message assistant-message agent-run";
    agentEl.appendChild(agentBody);
    chatMessages.appendChild(agentEl);
    scrollToBottom();

    const timeline = window.ChatreUIAdv && window.ChatreUIAdv.createTimeline
      ? window.ChatreUIAdv.createTimeline(agentBody)
      : null;
    if (timeline) timeline.setPhase("analyze", "Analyzing");

    let finalText = "";

    const showStep = (text, isFinal) => {
      let display = text;
      let confirmNodes = [];
      if (window.ChatrePlanUI) {
        confirmNodes = window.ChatrePlanUI.renderConfirmations(
          text,
          (action, question) => {
            window.ChatreUI.composeAndSend(
              "Approved: " +
                action +
                (question ? " — " + question : ""),
            );
          },
          (action, question) => {
            window.ChatreUI.composeAndSend(
              "Denied: " +
                action +
                (question ? " — " + question : ""),
            );
          },
        );
        display = window.ChatrePlanUI.stripConfirmationTags(text);
      }
      const p = document.createElement("div");
      p.className = "agent-text" + (isFinal ? " agent-final" : "");
      p.innerHTML = renderMarkdown(display);
      enhanceCodeBlocks(p);
      agentBody.appendChild(p);
      confirmNodes.forEach(function (node) {
        agentBody.appendChild(node);
      });
      scrollToBottom();
      if (isFinal) {
        finalText = display;
        if (timeline && timeline.setPhase) {
          timeline.setPhase("answer", "Answer");
        }
        if (window.ChatreUIAdv && window.ChatreUIAdv.clearLoginChip) {
          window.ChatreUIAdv.clearLoginChip();
        }
      }
    };

    const showTool = (call) => {
      if (window.ChatreUIAdv && window.ChatreUIAdv.renderToolCard) {
        const card = window.ChatreUIAdv.renderToolCard(call, timeline);
        if (!timeline) agentBody.appendChild(card);
        scrollToBottom();
        return card;
      }
      const card = document.createElement("div");
      card.className = "tool-call";
      card.dataset.toolId = call.id || call.tool;
      const params = call.params || {};
      const detail = formatToolParams(call.tool, params);
      card.innerHTML =
        '<div class="tool-call-header">' +
        '<span class="tool-icon">⚒</span>' +
        '<span class="tool-name">' +
        escapeHtml(call.tool) +
        "</span>" +
        '<span class="tool-status running">running…</span>' +
        '</div><div class="tool-call-detail">' +
        escapeHtml(detail) +
        '</div>' +
        '<div class="tool-call-result"></div>';
      agentBody.appendChild(card);
      scrollToBottom();
      return card;
    };

    const updateTool = (card, result) => {
      if (window.ChatreUIAdv && window.ChatreUIAdv.updateToolCard) {
        window.ChatreUIAdv.updateToolCard(card, result);
      }
      if (result && (result.path || result.title) && window.ChatreUIAdv && window.ChatreUIAdv.pushArtifact) {
        const toolName =
          (result && result.tool) ||
          (card && card.querySelector(".tool-name") && card.querySelector(".tool-name").textContent) ||
          "";
        if (/create_document|create_pdf|write_file/.test(toolName)) {
          window.ChatreUIAdv.pushArtifact({
            kind: toolName || "document",
            title: result.title || result.path || "Document",
            path: result.path,
          });
        }
      }
      const status = card.querySelector(".tool-status");
      const resultDiv = card.querySelector(".tool-call-result");
      if (result && result.ok === false) {
        status.textContent = "error";
        status.className = "tool-status error";
        resultDiv.className = "tool-call-result error";
        resultDiv.textContent = result.error || "failed";
      } else {
        status.textContent = "done";
        status.className = "tool-status done";
        const outText =
          (result && (result.guide || result.text || result.output || result.content)) ||
          "ok";
        resultDiv.textContent =
          typeof outText === "string" && outText.length > 500
            ? outText.slice(0, 500) + "\n…(truncated)"
            : outText;
      }
      scrollToBottom();
    };

    activeAbort = new AbortController();
    const toolCards = {};

    try {
      // Prefer remote Vercel+Firestore agent when configured
      if (window.ChatreRemote && window.ChatreRemote.enabled()) {
        const remoteState = window.__chatreRemote || {};
        let tokenEl = null;
        const handleAgentEvent = (ev) => {
            if (ev.type === "start") {
              window.__chatreRemote = {
                threadId: ev.threadId,
                workspaceId: ev.workspaceId,
              };
              startThinking(
                ev.resume ? "Resuming remote agent" : "Remote agent connected",
              );
              if (window.ChatrePanels) {
                window.ChatrePanels.setResumeAvailable(false);
                window.ChatrePanels.refreshThreads();
                window.ChatrePanels.refreshFiles();
                window.ChatrePanels.refreshAuthStatus();
              }
            } else if (ev.type === "resume") {
              startThinking("Resumed at step " + ev.step + "/" + ev.max);
            } else if (ev.type === "skills") {
              showStep(
                "Skills: " + ((ev.skills && ev.skills.join(", ")) || "none"),
                false,
              );
            } else if (ev.type === "phase") {
              startThinking(ev.text || ev.phase || "Working…");
              if (timeline && timeline.setPhase) {
                const p = ev.phase || "";
                timeline.setPhase(
                  p === "analyze"
                    ? "analyze"
                    : p === "critique"
                      ? "critique"
                      : p === "plan"
                        ? "plan"
                        : "tool",
                  ev.text || p || "Working",
                );
              }
            } else if (ev.type === "awaiting_login") {
              stopThinking();
              showStep(ev.reason || "Complete login / 2FA / CAPTCHA, then resume.", true);
              if (window.ChatreUIAdv && window.ChatreUIAdv.showLoginPause) {
                window.ChatreUIAdv.showLoginPause(ev.reason);
              }
              if (window.ChatrePanels) {
                window.ChatrePanels.setResumeAvailable(true, "awaiting_login");
              }
              const card = document.createElement("div");
              card.className = "login-pause-card";
              card.innerHTML = "<strong>Login pause</strong><p>" +
                String(ev.reason || "Finish auth in the browser, then click Resume after login.")
                  .replace(/&/g,"&amp;").replace(/</g,"&lt;") +
                "</p>";
              if (chatMessages) {
                chatMessages.appendChild(card);
                scrollToBottom();
              }
            } else if (ev.type === "action_trace") {
              const t = ev.trace || {};
              const line = document.createElement("div");
              line.className = "action-trace";
              line.textContent =
                "Trace · " + (ev.tool || "") +
                (t.url ? " · " + t.url : "") +
                (t.notes && t.notes.length ? "\n" + t.notes.join(", ") : "");
              if (agentBody) agentBody.appendChild(line);
              scrollToBottom();
            } else if (ev.type === "budget") {
              const usage = {
                model: modelSelect.value,
                steps: (ev.maxSteps || 0) - (ev.remainingSteps || 0),
                remainingSteps: ev.remainingSteps,
                maxSteps: ev.maxSteps,
                elapsedMs: ev.elapsedMs,
                toolsUsed: 0,
                totalTokensEst: 0,
              };
              if (window.ChatrePanels) window.ChatrePanels.updateUsageMeter(usage);
              if (window.ChatreUIAdv) window.ChatreUIAdv.updateBudgetBar(usage);
            } else if (ev.type === "download_detected") {
              showStep(
                "Download detected — confirm before saving:\n" +
                  ((ev.downloads || []).map(function(d){ return "- " + (d.url||""); }).join("\n") || "(unknown)"),
                false,
              );
            } else if (ev.type === "awaiting_plan") {
              stopThinking();
              window.__pendingPlan = {
                threadId: (window.__chatreRemote || {}).threadId,
                briefing: ev.briefing,
              };
              if (window.ChatrePanels) {
                window.ChatrePanels.setResumeAvailable(true, "awaiting_plan");
              }
              if (window.ChatreUIAdv && window.ChatreUIAdv.openPlanDrawer) {
                window.ChatreUIAdv.openPlanDrawer(
                  ev.briefing,
                  async (edited) => {
                    window.__pendingPlan = { briefing: edited };
                    if (window.ChatrePanels) {
                      window.ChatrePanels.setResumeAvailable(false);
                    }
                    if (window.ChatreUI && window.ChatreUI.resumeAgent) {
                      await window.ChatreUI.resumeAgent();
                    }
                  },
                  () => {
                    window.__pendingPlan = null;
                  },
                );
              } else if (window.ChatrePlanUI && chatMessages) {
                const card = window.ChatrePlanUI.renderPlanCard(
                  ev.briefing,
                  async (edited) => {
                    card.remove();
                    window.__pendingPlan = { briefing: edited };
                    if (window.ChatrePanels) {
                      window.ChatrePanels.setResumeAvailable(false);
                    }
                    if (window.ChatreUI && window.ChatreUI.resumeAgent) {
                      await window.ChatreUI.resumeAgent();
                    }
                  },
                  () => {
                    window.__pendingPlan = null;
                    card.remove();
                  },
                );
                chatMessages.appendChild(card);
                chatMessages.scrollTop = chatMessages.scrollHeight;
              }
            } else if (ev.type === "critique") {
              const c = ev.critique || {};
              const critText =
                "Critique: " +
                (c.pass ? "pass" : "needs work") +
                (c.score != null ? " (" + c.score + ")" : "");
              if (timeline && timeline.setPhase) {
                timeline.setPhase("critique", critText);
              } else {
                showStep(critText, false);
              }
            } else if (ev.type === "subagent") {
              showStep("Executor: " + (ev.label || ev.role || ""), false);
            } else if (ev.type === "analysis") {
              stopThinking();
              const b = ev.briefing || {};
              const bits = [];
              if (b.task_type) bits.push(b.task_type);
              if (b.goal) bits.push(b.goal);
              const planText =
                "Plan: " + (bits.join(" — ") || "ready").slice(0, 160);
              if (timeline && timeline.setPhase) {
                timeline.setPhase("plan", planText);
              } else {
                showStep(planText, false);
              }
            } else if (ev.type === "todos") {
              showStep(
                "Todos:\n" +
                  ((ev.todos || [])
                    .map(
                      (t) =>
                        (t.status === "done" ? "- [x] " : "- [ ] ") +
                        t.id +
                        ": " +
                        t.content,
                    )
                    .join("\n") || "(empty)"),
                false,
              );
            } else if (ev.type === "thinking") {
              startThinking("Agent step " + ev.step + "/" + ev.max);
              if (ev.usage && window.ChatrePanels) {
                window.ChatrePanels.updateUsageMeter({
                  ...ev.usage,
                  model: modelSelect.value,
                });
              }
            } else if (ev.type === "token") {
              stopThinking();
              if (!tokenEl) {
                tokenEl = document.createElement("div");
                tokenEl.className = "token-stream";
                agentBody.appendChild(tokenEl);
              }
              tokenEl.textContent += ev.delta || "";
              scrollToBottom();
            } else if (ev.type === "text") {
              stopThinking();
              if (tokenEl) {
                tokenEl.remove();
                tokenEl = null;
              }
              showStep(ev.text, !!ev.final);
              if (ev.usage && window.ChatrePanels) {
                window.ChatrePanels.updateUsageMeter({
                  ...ev.usage,
                  model: modelSelect.value,
                });
              }
              if (ev.final) {
                chatHistory.push({ role: "assistant", content: ev.text });
                trimHistory();
              }
            } else if (ev.type === "tool_start") {
              if (tokenEl) {
                tokenEl.remove();
                tokenEl = null;
              }
              const card = showTool(ev);
              toolCards[ev.id || ev.tool] = card;
            } else if (ev.type === "tool_result") {
              const card = toolCards[ev.id || ev.tool];
              if (card) updateTool(card, ev.result);
              if (
                ev.result &&
                ev.result.path &&
                window.ChatrePanels &&
                window.ChatrePanels.rememberWrite
              ) {
                window.ChatrePanels.rememberWrite(
                  ev.result.path,
                  ev.result.previous,
                  ev.result.content,
                );
              }
              if (window.ChatrePanels) window.ChatrePanels.refreshFiles();
            } else if (ev.type === "error") {
              showStep("Agent error: " + (ev.error || "unknown"), true);
            } else if (ev.type === "interrupted") {
              stopThinking();
              if (tokenEl) {
                tokenEl.remove();
                tokenEl = null;
              }
              showStep(
                (ev.response || "Agent paused for durability.") +
                  "\n\nClick **Resume** to continue from the last checkpoint.",
                true,
              );
              if (ev.usage && window.ChatrePanels) {
                window.ChatrePanels.updateUsageMeter({
                  ...ev.usage,
                  model: modelSelect.value,
                });
              }
              if (window.ChatrePanels) {
                window.ChatrePanels.setResumeAvailable(true);
                window.ChatrePanels.refreshThreads();
                window.ChatrePanels.refreshFiles();
              }
            } else if (ev.type === "done") {
              if (window.ChatrePanels) {
                window.ChatrePanels.setResumeAvailable(false);
              }
              if (ev.usage && window.ChatrePanels) {
                window.ChatrePanels.updateUsageMeter({
                  ...ev.usage,
                  model: modelSelect.value,
                });
              }
              if (ev.response && !finalText) {
                showStep(ev.response, true);
                chatHistory.push({ role: "assistant", content: ev.response });
                trimHistory();
              }
              if (window.ChatrePanels) {
                window.ChatrePanels.refreshThreads();
                window.ChatrePanels.refreshFiles();
              }
            }
        };

        await window.ChatreRemote.runAgentStream({
          message,
          threadId: remoteState.threadId || null,
          workspaceId: remoteState.workspaceId || null,
          model: modelSelect.value,
          signal: activeAbort.signal,
          onEvent: handleAgentEvent,
        });
      } else if (window.ChatreAgent && window.ChatreTools) {
        let tokenEl = null;
        const resumeMsgs = (opts && opts.resumeMessages) || null;
        const initialMessages = resumeMsgs && resumeMsgs.length
          ? resumeMsgs.map((m) => ({ role: m.role, content: m.content }))
          : [...chatHistory];
        if (resumeMsgs && resumeMsgs.length && message) {
          initialMessages.push({ role: "user", content: message });
        }

        const agentResult = await window.ChatreAgent.run(initialMessages, {
          model: modelSelect.value,
          maxTokens: 3072,
          callbacks: {
            onSkills: (skills) => {
              if (skills && skills.length) {
                showStep("Skills: " + skills.join(", "), false);
              }
            },
            onPhase: (phase, text) => {
              startThinking(text || (phase === "analyze" ? "Analyzing…" : "Working…"));
              if (timeline && timeline.setPhase) {
                timeline.setPhase(
                  phase === "analyze" ? "analyze" : phase === "critique" ? "critique" : "tool",
                  text || phase || "Working",
                );
              }
            },
            onAnalysis: (briefing) => {
              stopThinking();
              if (!briefing) return;
              const bits = [];
              if (briefing.task_type) bits.push(briefing.task_type);
              if (briefing.goal) bits.push(briefing.goal);
              showStep(
                "Plan: " + (bits.join(" — ") || "ready").slice(0, 160),
                false,
              );
            },
            onAwaitPlan: (briefing) => {
              return new Promise((resolve) => {
                stopThinking();
                if (window.ChatreUIAdv && window.ChatreUIAdv.openPlanDrawer) {
                  window.ChatreUIAdv.openPlanDrawer(
                    briefing,
                    (edited) => resolve(edited),
                    () => resolve(null),
                  );
                  return;
                }
                if (!window.ChatrePlanUI || !chatMessages) {
                  resolve(briefing);
                  return;
                }
                const card = window.ChatrePlanUI.renderPlanCard(
                  briefing,
                  (edited) => {
                    card.remove();
                    resolve(edited);
                  },
                  () => {
                    card.remove();
                    resolve(null);
                  },
                );
                chatMessages.appendChild(card);
              });
            },
            onThinking: (iter, max) => {
              startThinking("Agent step " + iter + "/" + max);
              if (window.ChatrePanels) {
                window.ChatrePanels.updateUsageMeter({
                  model: modelSelect.value,
                  steps: iter,
                  toolsUsed: Object.keys(toolCards).length,
                  totalTokensEst: 0,
                });
              }
            },
            onToken: (delta) => {
              stopThinking();
              if (!tokenEl) {
                tokenEl = document.createElement("div");
                tokenEl.className = "token-stream";
                agentBody.appendChild(tokenEl);
              }
              tokenEl.textContent += delta || "";
              scrollToBottom();
            },
            onStepText: (text, isFinal) => {
              stopThinking();
              if (tokenEl) {
                tokenEl.remove();
                tokenEl = null;
              }
              showStep(text, isFinal);
              if (isFinal) {
                chatHistory.push({ role: "assistant", content: text });
                trimHistory();
              }
            },
            onToolStart: (call) => {
              if (tokenEl) {
                tokenEl.remove();
                tokenEl = null;
              }
              const card = showTool(call);
              toolCards[call.id] = card;
            },
            onToolResult: (call, result) => {
              const card = toolCards[call.id];
              if (card) updateTool(card, result);
              if (window.ChatrePanels) window.ChatrePanels.refreshFiles();
            },
            onDone: (res) => {
              if (window.ChatrePanels) {
                window.ChatrePanels.updateUsageMeter({
                  model: modelSelect.value,
                  steps: res.iterations || 0,
                  toolsUsed: res.toolsUsed || 0,
                  totalTokensEst: Math.ceil(
                    String(res.response || "").length / 4,
                  ),
                });
              }
              // Surface usage directly in the agent card.
              if (!agentEl.querySelector(".agent-meta")) {
                const meta = document.createElement("div");
                meta.className = "agent-meta";
                meta.textContent =
                  "Ran " +
                  (res.iterations || 0) +
                  " steps · " +
                  (res.toolsUsed || 0) +
                  " tool calls" +
                  (res.intent ? " · " + res.intent : "") +
                  (res.cancelled ? " · interrupted" : "");
                agentEl.appendChild(meta);
              }
              if (res.cancelled && !finalText) {
                showStep(res.response || "(stopped)", true);
              }
              // Tappable preference buttons: render chips and wait for the
              // user's choice (the next message resumes this thread).
              if (res.userInput && res.userInput.options && res.userInput.options.length) {
                skipChips = true;
                window.__pendingUserInput = res.userInput;
                window.__pendingClarification = false;
                if (window.ChatrePanels) window.ChatrePanels.setResumeAvailable(true);
                renderOptionButtons(agentBody, res.userInput);
              }
              // Connector suggestion cards: Connect / Use / None buttons.
              if (
                res.suggestedConnectors &&
                res.suggestedConnectors.connectors &&
                res.suggestedConnectors.connectors.length
              ) {
                skipChips = true;
                window.__pendingConnectors = res.suggestedConnectors;
                window.__pendingClarification = false;
                if (window.ChatrePanels) window.ChatrePanels.setResumeAvailable(true);
                renderConnectorCards(agentBody, res.suggestedConnectors);
              }
            },
            onError: (err) => {
              stopThinking();
              showStep("Agent error: " + (err.message || String(err)), true);
            },
          },
        });

        // Local resume bookkeeping: persist interrupted runs so /Resume works.
        const interrupted = !!(
          agentResult &&
          (agentResult.cancelled || agentResult.error)
        );
        if (interrupted && agentResult.messages && agentResult.messages.length) {
          window.__localResumeMessages = agentResult.messages;
          window.__pendingClarification = false;
          if (window.ChatrePanels) {
            window.ChatrePanels.setResumeAvailable(true);
          }
        } else if (
          agentResult &&
          agentResult.askedClarification &&
          agentResult.messages &&
          agentResult.messages.length
        ) {
          // Agent stopped to ask a question — the next user message is the
          // answer and should resume this thread automatically.
          window.__localResumeMessages = agentResult.messages;
          window.__pendingClarification = true;
          if (window.ChatrePanels) {
            window.ChatrePanels.setResumeAvailable(true);
          }
        } else {
          window.__localResumeMessages = null;
          window.__pendingClarification = false;
          if (window.ChatrePanels) {
            window.ChatrePanels.setResumeAvailable(false);
          }
        }
      } else {
        showStep("Agent runtime not loaded.", true);
      }
    } catch (e) {
      if (e && e.name === "AbortError") {
        showStep("*(agent stopped)*", true);
      } else {
        console.error(e);
        showStep("Agent failed: " + (e.message || String(e)), true);
      }
    } finally {
      stopThinking();
      setBusy(false);
      userInput.focus();
      if (!skipChips) {
        appendSuggestionChips(agentEl, finalText || "project");
      }
    }
  }

  function formatToolParams(tool, params) {
    if (!params) return "";
    if (tool === "write_file" || tool === "append_file") {
      return (
        "path: " +
        (params.path || "?") +
        "  (" +
        String(params.content || "").length +
        " chars)"
      );
    }
    if (tool === "execute_command") return "$ " + (params.cmd || "");
    if (tool === "navigate") return "url: " + (params.url || "");
    if (tool === "computer") return String(params.action || "act");
    if (tool === "search_web")
      return JSON.stringify(params.queries || params.query || "");
    if (tool === "read_page" || tool === "get_page_text")
      return "tab " + (params.tab_id || "");
    if (tool === "browser_navigate") return "url: " + (params.url || "");
    if (tool === "browser_click") return "click " + (params.selector || "");
    if (tool === "browser_type")
      return (params.selector || "") + " ← " + String(params.text || "").slice(0, 40);
    if (tool === "http_request")
      return (params.method || "GET") + " " + (params.url || "");
    if (tool === "create_document") return "title: " + (params.title || "document");
    if (tool === "create_pdf")
      return (
        "title: " +
        (params.title || "document") +
        "  (" +
        String(params.content || "").length +
        " chars → PDF)"
      );
    if (tool === "export_document") return "path: " + (params.path || "");
    if (tool === "use_skill") return "skill: " + (params.name || "");
    if (tool === "ask_user_input")
      return (
        "→ " +
        String(params.question || "").slice(0, 80) +
        "  [" +
        (Array.isArray(params.options) ? params.options.length : 0) +
        " options]"
      );
    if (tool === "search_mcp_registry")
      return (
        "search: " +
        JSON.stringify(params.queries || params.query || "")
      );
    if (tool === "suggest_connectors")
      return (
        "connectors: " +
        (Array.isArray(params.uuids) ? params.uuids.join(", ") : params.uuids || "")
      );
    if (tool === "call_mcp")
      return (
        (params.server || "?") + " :: " + (params.tool || "?")
      );
    if (tool === "list_mcp_tools")
      return "server: " + (params.server || "");
    if (tool === "git_commit") return "message: " + (params.message || "");
    if (tool === "git_push") {
      return (
        (params.remote || "origin") + "/" + (params.branch || "main")
      );
    }
    if (tool === "plan") return "steps: " + String(params.steps || "").slice(0, 120);
    if (tool === "verify_project") return "path: " + (params.path || ".");
    const entries = Object.entries(params).filter(
      ([, v]) => v !== undefined && v !== null && v !== "",
    );
    return entries.map(([k, v]) => k + ": " + String(v)).join("  ") || "(no params)";
  }

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

  // ── ChatreCore export (used by tools.js / agent.js) ──────────────

  window.ChatreCore = {
    fs: fileSystem,
    cwd: () => currentDir,
    setCwd: (p) => { currentDir = p; },
    resolve: (p) => resolvePath(p),
    git: gitState,
    authHeaders: () => authHeaders(),
    runJS: (code) => {
      try {
        const result = new Function("return (" + code + ")")();
        return { ok: true, output: result === undefined ? "(undefined)" : String(result), text: "JS executed" };
      } catch (e) {
        return { ok: false, error: e.message || String(e), output: e.message || String(e) };
      }
    },
    runPython: async (code) => {
      if (!pyodide && !pyodideLoading) {
        pyodideLoading = true;
        try {
          if (!window.loadPyodide) {
            await loadScript("https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js");
          }
          pyodide = await window.loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/" });
        } catch (e) {
          pyodideLoading = false;
          return { ok: false, error: "Failed to load Python: " + (e.message || e) };
        }
        pyodideLoading = false;
      }
      if (!pyodide) return { ok: false, error: "Python runtime not available" };
      try {
        const result = pyodide.runPython(code);
        return { ok: true, output: result !== undefined && result !== null ? String(result) : "(no output)", text: "Python executed" };
      } catch (e) {
        return { ok: false, error: e.message || String(e) };
      }
    },
  };

  showGreeting();

  window.ChatreUI = {
    setAgentMode: function (on) {
      agentMode = !!on;
      const btn = document.getElementById("agent-mode-button");
      if (btn) {
        btn.classList.toggle("active", agentMode);
        btn.setAttribute("aria-pressed", agentMode ? "true" : "false");
      }
      const mc = document.getElementById("mode-control");
      if (mc) {
        mc.querySelectorAll("[data-mode]").forEach(function (b) {
          const active =
            (agentMode && b.getAttribute("data-mode") === "agent") ||
            (!agentMode && b.getAttribute("data-mode") === "chat");
          b.classList.toggle("active", active);
        });
      }
    },
    formatToolParams: formatToolParams,
    resetChat: function (messages) {
      chatHistory = [];
      chatMessages.innerHTML = "";
      const list = Array.isArray(messages) ? messages : [];
      if (!list.length) {
        showGreeting();
        return;
      }
      if (window.ChatreUIAdv && window.ChatreUIAdv.hideStarterChips) {
        window.ChatreUIAdv.hideStarterChips();
      }
      list.forEach((m) => {
        if (!m || !m.role) return;
        if (m.role === "system") return;
        addMessage(m.role === "assistant" ? "assistant" : "user", m.content || "");
        if (m.role === "user" || m.role === "assistant") {
          chatHistory.push({ role: m.role, content: m.content || "" });
        }
      });
      trimHistory();
    },
    getHistory: function () {
      return chatHistory.slice();
    },
    composeAndSend: function (text) {
      const msg = String(text || "").trim();
      if (!msg) return;
      userInput.value = msg;
      autoResize();
      if (typeof sendMessage === "function") {
        sendMessage();
      } else {
        document.getElementById("send-button").click();
      }
    },
    resumeAgent: async function () {
      if (isProcessing) return;
      if (window.__localResumeMessages && window.__localResumeMessages.length) {
        return runAgentTask(null, {
          resumeMessages: window.__localResumeMessages,
        });
      }
      if (!window.ChatreRemote || !window.ChatreRemote.enabled()) return;
      const remoteState = window.__chatreRemote || {};
      if (!remoteState.threadId) {
        addMessage("assistant", "No thread to resume.");
        return;
      }
      if (isProcessing) return;
      setBusy(true, "agent");
      startThinking("Resuming agent from checkpoint");

      const agentBody = document.createElement("div");
      agentBody.className = "agent-body";
      const agentEl = document.createElement("div");
      agentEl.className = "message assistant-message agent-run";
      agentEl.appendChild(agentBody);
      chatMessages.appendChild(agentEl);
      scrollToBottom();

      let finalText = "";
      const timeline = window.ChatreUIAdv && window.ChatreUIAdv.createTimeline
        ? window.ChatreUIAdv.createTimeline(agentBody)
        : null;
      const showStep = (text, isFinal) => {
        let display = text;
        let confirmNodes = [];
        if (window.ChatrePlanUI) {
          confirmNodes = window.ChatrePlanUI.renderConfirmations(
            text,
            (action, question) => {
              window.ChatreUI.composeAndSend(
                "Approved: " +
                  action +
                  (question ? " — " + question : ""),
              );
            },
            (action, question) => {
              window.ChatreUI.composeAndSend(
                "Denied: " +
                  action +
                  (question ? " — " + question : ""),
              );
            },
          );
          display = window.ChatrePlanUI.stripConfirmationTags(text);
        }
        const p = document.createElement("div");
        p.className = "agent-text" + (isFinal ? " agent-final" : "");
        p.innerHTML = renderMarkdown(display);
        enhanceCodeBlocks(p);
        agentBody.appendChild(p);
        confirmNodes.forEach(function (node) {
          agentBody.appendChild(node);
        });
        scrollToBottom();
        if (isFinal) {
          finalText = display;
          if (timeline && timeline.setPhase) {
            timeline.setPhase("answer", "Answer");
          }
        }
      };
      const showTool = (call) => {
        if (window.ChatreUIAdv && window.ChatreUIAdv.renderToolCard) {
          const card = window.ChatreUIAdv.renderToolCard(call, timeline);
          if (!timeline) agentBody.appendChild(card);
          scrollToBottom();
          return card;
        }
        const card = document.createElement("div");
        card.className = "tool-call";
        card.dataset.toolId = call.id || call.tool;
        const params = call.params || {};
        const detail = formatToolParams(call.tool, params);
        card.innerHTML =
          '<div class="tool-call-header">' +
          '<span class="tool-icon">⚒</span>' +
          '<span class="tool-name">' +
          escapeHtml(call.tool) +
          "</span>" +
          '<span class="tool-status running">running…</span>' +
          '</div><div class="tool-call-detail">' +
          escapeHtml(detail) +
          "</div>" +
          '<div class="tool-call-result"></div>';
        agentBody.appendChild(card);
        scrollToBottom();
        return card;
      };
      const updateTool = (card, result) => {
        if (window.ChatreUIAdv && window.ChatreUIAdv.updateToolCard) {
          window.ChatreUIAdv.updateToolCard(card, result);
        }
        const status = card.querySelector(".tool-status");
        const resultDiv = card.querySelector(".tool-call-result");
        if (result && result.ok === false) {
          status.textContent = "error";
          status.className = "tool-status error";
          resultDiv.className = "tool-call-result error";
          resultDiv.textContent = result.error || "failed";
        } else {
          status.textContent = "done";
          status.className = "tool-status done";
          const outText =
            (result &&
              (result.guide || result.text || result.output || result.content)) ||
            "ok";
          resultDiv.textContent =
            typeof outText === "string" && outText.length > 500
              ? outText.slice(0, 500) + "\n…(truncated)"
              : outText;
        }
        scrollToBottom();
      };

      activeAbort = new AbortController();
      const toolCards = {};
      let tokenEl = null;

      try {
        const pendingPlan = window.__pendingPlan;
        const approvingPlan = !!(pendingPlan && pendingPlan.briefing);
        if (approvingPlan) {
          window.__pendingPlan = null;
        }
        await window.ChatreRemote.runAgentStream({
          resume: true,
          approvePlan: approvingPlan,
          briefing: approvingPlan ? pendingPlan.briefing : undefined,
          threadId: remoteState.threadId,
          workspaceId: remoteState.workspaceId || null,
          model: modelSelect.value,
          signal: activeAbort.signal,
          onEvent: (ev) => {
            if (ev.type === "start") {
              window.__chatreRemote = {
                threadId: ev.threadId,
                workspaceId: ev.workspaceId,
              };
              if (window.ChatrePanels) {
                window.ChatrePanels.setResumeAvailable(false);
              }
              startThinking(
                approvingPlan
                  ? "Continuing approved plan"
                  : "Resuming remote agent",
              );
              if (window.ChatreUIAdv && window.ChatreUIAdv.clearLoginChip) {
                window.ChatreUIAdv.clearLoginChip();
              }
            } else if (ev.type === "awaiting_login") {
              stopThinking();
              showStep(ev.reason || "Complete login / 2FA / CAPTCHA, then resume.", true);
              if (window.ChatreUIAdv && window.ChatreUIAdv.showLoginPause) {
                window.ChatreUIAdv.showLoginPause(ev.reason);
              }
              if (window.ChatrePanels) {
                window.ChatrePanels.setResumeAvailable(true, "awaiting_login");
              }
              const card = document.createElement("div");
              card.className = "login-pause-card";
              card.innerHTML = "<strong>Login pause</strong><p>" +
                String(ev.reason || "Finish auth in the browser, then click Resume after login.")
                  .replace(/&/g,"&amp;").replace(/</g,"&lt;") +
                "</p>";
              if (chatMessages) {
                chatMessages.appendChild(card);
                scrollToBottom();
              }
            } else if (ev.type === "action_trace") {
              const t = ev.trace || {};
              const line = document.createElement("div");
              line.className = "action-trace";
              line.textContent =
                "Trace · " + (ev.tool || "") +
                (t.url ? " · " + t.url : "") +
                (t.notes && t.notes.length ? "\n" + t.notes.join(", ") : "");
              if (agentBody) agentBody.appendChild(line);
              scrollToBottom();
            } else if (ev.type === "budget") {
              const usage = {
                model: modelSelect.value,
                steps: (ev.maxSteps || 0) - (ev.remainingSteps || 0),
                remainingSteps: ev.remainingSteps,
                maxSteps: ev.maxSteps,
                elapsedMs: ev.elapsedMs,
                toolsUsed: 0,
                totalTokensEst: 0,
              };
              if (window.ChatrePanels) window.ChatrePanels.updateUsageMeter(usage);
              if (window.ChatreUIAdv) window.ChatreUIAdv.updateBudgetBar(usage);
            } else if (ev.type === "download_detected") {
              showStep(
                "Download detected — confirm before saving:\n" +
                  ((ev.downloads || []).map(function(d){ return "- " + (d.url||""); }).join("\n") || "(unknown)"),
                false,
              );
            } else if (ev.type === "awaiting_plan") {
              stopThinking();
              window.__pendingPlan = {
                threadId: remoteState.threadId,
                briefing: ev.briefing,
              };
              if (window.ChatrePanels) {
                window.ChatrePanels.setResumeAvailable(true, "awaiting_plan");
              }
              if (window.ChatreUIAdv && window.ChatreUIAdv.openPlanDrawer) {
                window.ChatreUIAdv.openPlanDrawer(
                  ev.briefing,
                  async (edited) => {
                    window.__pendingPlan = { briefing: edited };
                    if (window.ChatrePanels) {
                      window.ChatrePanels.setResumeAvailable(false);
                    }
                    await window.ChatreUI.resumeAgent();
                  },
                  () => {
                    window.__pendingPlan = null;
                  },
                );
              } else if (window.ChatrePlanUI && chatMessages) {
                const card = window.ChatrePlanUI.renderPlanCard(
                  ev.briefing,
                  async (edited) => {
                    card.remove();
                    window.__pendingPlan = { briefing: edited };
                    if (window.ChatrePanels) {
                      window.ChatrePanels.setResumeAvailable(false);
                    }
                    await window.ChatreUI.resumeAgent();
                  },
                  () => {
                    window.__pendingPlan = null;
                    card.remove();
                  },
                );
                chatMessages.appendChild(card);
                scrollToBottom();
              }
            } else if (ev.type === "resume") {
              startThinking("Resumed at step " + ev.step + "/" + ev.max);
            } else if (ev.type === "thinking") {
              startThinking("Agent step " + ev.step + "/" + ev.max);
              if (ev.usage && window.ChatrePanels) {
                window.ChatrePanels.updateUsageMeter({
                  ...ev.usage,
                  model: modelSelect.value,
                });
              }
            } else if (ev.type === "token") {
              stopThinking();
              if (!tokenEl) {
                tokenEl = document.createElement("div");
                tokenEl.className = "token-stream";
                agentBody.appendChild(tokenEl);
              }
              tokenEl.textContent += ev.delta || "";
              scrollToBottom();
            } else if (ev.type === "text") {
              stopThinking();
              if (tokenEl) {
                tokenEl.remove();
                tokenEl = null;
              }
              showStep(ev.text, !!ev.final);
              if (ev.final) {
                chatHistory.push({ role: "assistant", content: ev.text });
                trimHistory();
              }
            } else if (ev.type === "tool_start") {
              if (tokenEl) {
                tokenEl.remove();
                tokenEl = null;
              }
              toolCards[ev.id || ev.tool] = showTool(ev);
            } else if (ev.type === "tool_result") {
              const card = toolCards[ev.id || ev.tool];
              if (card) updateTool(card, ev.result);
              if (window.ChatrePanels) window.ChatrePanels.refreshFiles();
            } else if (ev.type === "interrupted") {
              showStep(
                (ev.response || "Paused again.") +
                  "\n\nClick **Resume** to continue.",
                true,
              );
              if (window.ChatrePanels) {
                window.ChatrePanels.setResumeAvailable(true);
              }
            } else if (ev.type === "done") {
              if (window.ChatrePanels) {
                window.ChatrePanels.setResumeAvailable(false);
              }
              if (ev.response && !finalText) {
                showStep(ev.response, true);
                chatHistory.push({ role: "assistant", content: ev.response });
                trimHistory();
              }
              if (ev.usage && window.ChatrePanels) {
                window.ChatrePanels.updateUsageMeter({
                  ...ev.usage,
                  model: modelSelect.value,
                });
              }
              if (window.ChatrePanels) {
                window.ChatrePanels.refreshThreads();
                window.ChatrePanels.refreshFiles();
              }
            } else if (ev.type === "error") {
              showStep("Resume error: " + (ev.error || "unknown"), true);
            }
          },
        });
      } catch (e) {
        if (e && e.name === "AbortError") {
          showStep("*(resume stopped)*", true);
        } else {
          showStep("Resume failed: " + (e.message || String(e)), true);
        }
      } finally {
        stopThinking();
        setBusy(false);
        userInput.focus();
      }
    },
  };
})();
