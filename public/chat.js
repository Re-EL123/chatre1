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
    { cmd: "/clear", desc: "Clear chat history", action: () => { chatHistory = []; chatMessages.innerHTML = ""; showGreeting(); } },
    { cmd: "/help", desc: "Show help and available commands", action: () => addMessage("assistant", "Available commands:\n- `/image <prompt>`: Generate an AI image\n- `/clear`: Reset chat history\n- `/help`: Show this help message\n- `/model`: Show active model") },
    { cmd: "/model", desc: "Show current model info", action: () => addMessage("assistant", "Current active model: `" + modelSelect.value + "`") },
  ];

  /** @type {{ role: string, content: string }[]} */
  let chatHistory = [];
  let isProcessing = false;
  let imageMode = false;
  /** @type {AbortController | null} */
  let activeAbort = null;
  let thinkingTimer = null;
  let selectedSlashIndex = 0;

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
        ADD_ATTR: ["target", "rel", "class", "src", "alt", "width", "height"],
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
            ADD_TAGS: ["img"],
            ADD_ATTR: ["src", "alt", "class", "width", "height"],
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
        '" alt="Generated image">';
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

  showGreeting();
})();
