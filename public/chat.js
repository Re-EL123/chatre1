/**
 * LLM Chat App Frontend
 *
 * Handles the chat UI interactions and communication with the backend API.
 */

// DOM elements
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");

// ======= 1. REACT-STYLE BUTTON ANIMATION =======
sendButton.classList.add("animated-button");
sendButton.addEventListener("click", function (e) {
  const ripple = document.createElement("span");
  ripple.className = "ripple";
  const size = Math.max(sendButton.offsetWidth, sendButton.offsetHeight);
  ripple.style.width = ripple.style.height = size + "px";
  ripple.style.left = e.offsetX - size / 2 + "px";
  ripple.style.top = e.offsetY - size / 2 + "px";
  sendButton.appendChild(ripple);
  setTimeout(() => ripple.remove(), 500);
});

// ======= 2. RANDOM GREETING =======
const greetings = [
  "Hey there! 🚀 How can I assist you today?",
  "Hi! Ready to chat? 🌌",
  "Hello! What can I do for you?",
  "Welcome! Ask me anything.",
  "Greetings, human! 🤖",
  "Yo! Need some help?",
  "Hi! How may I make your day better?",
  "Hey! What can I fetch for you?",
  "Hello! I'm here to help.",
  "Hi! Let's get started."
];
let chatHistory = [
  {
    role: "assistant",
    content: greetings[Math.floor(Math.random() * greetings.length)],
  },
];
let isProcessing = false;

// Auto-resize textarea as user types
userInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = this.scrollHeight + "px";
});

// Send message on Enter (without Shift)
userInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Send button click handler
sendButton.addEventListener("click", sendMessage);

/**
 * Sends a message to the chat API and processes the response
 */
async function sendMessage() {
  const message = userInput.value.trim();

  // Don't send empty messages
  if (message === "" || isProcessing) return;

  // If it's an image request, route to image generator
  const lower = message.toLowerCase();
  if (
    lower.startsWith("draw") ||
    lower.startsWith("create image") ||
    lower.startsWith("generate image") ||
    lower.startsWith("show me")
  ) {
    return generateImage(message);
  }

  // Disable input while processing
  isProcessing = true;
  userInput.disabled = true;
  sendButton.disabled = true;

  // Add user message to chat
  addMessageToChat("user", message);

  // Clear input
  userInput.value = "";
  userInput.style.height = "auto";

  // ======= 3. SHOW ANIMATED TYPING INDICATOR =======
  typingIndicator.classList.add("visible");
  startThinkingAnimation();

  // Add message to history
  chatHistory.push({ role: "user", content: message });

  try {
    // Create new assistant response element
    const assistantMessageEl = document.createElement("div");
    assistantMessageEl.className = "message assistant-message fresh";
    assistantMessageEl.innerHTML = "<p></p>";
    chatMessages.appendChild(assistantMessageEl);

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Send request to API
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: chatHistory,
      }),
    });

    // Handle errors
    if (!response.ok) {
      throw new Error("Failed to get response");
    }

    // Process streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let responseText = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      // Decode chunk
      const chunk = decoder.decode(value, { stream: true });

      // Process SSE format
      const lines = chunk.split("\n");
      for (const line of lines) {
        try {
          const jsonData = JSON.parse(line);
          if (jsonData.response) {
            // Append new content to existing text
            responseText += jsonData.response;
            assistantMessageEl.querySelector("p").textContent = responseText;

            // Scroll to bottom
            chatMessages.scrollTop = chatMessages.scrollHeight;
          }
        } catch (e) {
          console.error("Error parsing JSON:", e);
        }
      }
    }

    // Add completed response to chat history
    chatHistory.push({ role: "assistant", content: responseText });

    // ======= 4. RESPONSE ANIMATION =======
    assistantMessageEl.classList.add("fresh");
    setTimeout(() => assistantMessageEl.classList.remove("fresh"), 1300);
  } catch (error) {
    console.error("Error:", error);
    addMessageToChat(
      "assistant",
      "Sorry, there was an error processing your request."
    );
  } finally {
    // Hide typing indicator
    stopThinkingAnimation();
    typingIndicator.classList.remove("visible");

    // Re-enable input
    isProcessing = false;
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.focus();
  }
}

/**
 * Helper function to add message to chat
 */
function addMessageToChat(role, content) {
  const messageEl = document.createElement("div");
  messageEl.className = `message ${role}-message`;
  messageEl.innerHTML = `<p>${content}</p>`;
  chatMessages.appendChild(messageEl);

  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // ======= 5. ANIMATE ASSISTANT MESSAGE =======
  if (role === "assistant") {
    messageEl.classList.add("fresh");
    setTimeout(() => messageEl.classList.remove("fresh"), 1300);
  }
}

/**
 * Typing (thinking) animation
 */
let thinkingDotsInterval = null;
function startThinkingAnimation() {
  if (!typingIndicator) return;
  let dots = 0;
  typingIndicator.innerHTML = `<span>Thinking</span><span class="dot"></span><span class="dot"></span><span class="dot"></span>`;
  const dotEls = typingIndicator.querySelectorAll(".dot");
  thinkingDotsInterval = setInterval(() => {
    dots = (dots + 1) % 4;
    dotEls.forEach((el, i) => {
      el.style.opacity = i < dots ? "1" : "0.5";
      el.style.transform = i < dots ? "scale(1.25)" : "scale(1)";
    });
  }, 350);
}
function stopThinkingAnimation() {
  if (thinkingDotsInterval) clearInterval(thinkingDotsInterval);
  if (typingIndicator) typingIndicator.innerHTML = "";
}

/**
 * ================= IMAGE GENERATION =================
 */
async function generateImage(prompt) {
  isProcessing = true;
  userInput.disabled = true;
  sendButton.disabled = true;

  addMessageToChat("user", "[Image Request] " + prompt);

  // Clear input
  userInput.value = "";
  userInput.style.height = "auto";

  typingIndicator.classList.add("visible");
  startThinkingAnimation();

  try {
    const response = await fetch("/api/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) throw new Error("Image API failed");

    // Parse JSON
    const data = await response.json();

    if (data.image_base64) {
      // Build data URL from base64
      const imageUrl = `data:image/png;base64,${data.image_base64}`;

      addMessageToChat(
        "assistant",
        `Here is your generated image:<br><img src="${imageUrl}" alt="Generated Image" class="rounded-lg mt-2 max-w-xs">`
      );
    } else {
      addMessageToChat("assistant", "⚠️ No image returned.");
      console.error("No image in response:", data);
    }
  } catch (err) {
    console.error("⚠️ Image generation failed:", err);
    addMessageToChat("assistant", "⚠️ Image generation failed.");
  } finally {
    stopThinkingAnimation();
    typingIndicator.classList.remove("visible");
    isProcessing = false;
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.focus();
  }
}
