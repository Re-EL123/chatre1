/**
 * Chatre Agent — agentic loop controller.
 * Drives the plan → tool-call → execute → feed-back loop.
 */
(function () {
  "use strict";

  const MAX_ITERATIONS = 15;
  const AGENT_MODEL_CONTEXT = 6000;

  class AgentController {
    constructor() {
      this.maxIterations = MAX_ITERATIONS;
      this.running = false;
      this.abortController = null;
      this.iteration = 0;
    }

    isRunning() {
      return this.running;
    }

    stop() {
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
    }

    /**
     * Run the full agentic loop.
     * @param {Array} initialMessages chat messages (include user's prompt)
     * @param {Object} options { model, maxTokens, callbacks }
     *   callbacks: onPlan, onToolStart, onToolResult, onStepText, onThinking,
     *              onDone, onError, onFinal
     */
    async run(initialMessages, options) {
      if (this.running) return { response: "", cancelled: true };
      this.running = true;
      this.iteration = 0;
      this.abortController = new AbortController();
      const signal = this.abortController.signal;
      const callbacks = options && options.callbacks ? options.callbacks : {};
      const model = (options && options.model) || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
      const maxTokens = (options && options.maxTokens) || 1500;

      const messages = initialMessages.slice();
      let fullAssistantText = "";
      let cancelled = false;

      try {
        for (let i = 0; i < this.maxIterations; i++) {
          this.iteration = i + 1;
          if (signal.aborted) {
            cancelled = true;
            break;
          }

          callbacks.onThinking && callbacks.onThinking(i + 1, this.maxIterations);

          const response = await fetch("/api/chat", {
            method: "POST",
            headers: window.ChatreCore.authHeaders(),
            signal,
            body: JSON.stringify({
              messages,
              stream: false,
              model,
              max_tokens: maxTokens,
            }),
          });

          if (!response.ok) {
            let errMsg = "Agent API failed";
            try {
              const err = await response.json();
              if (err && err.error) errMsg = err.error;
            } catch (e) {
              /* ignore */
            }
            throw new Error(errMsg);
          }

          const data = await response.json();
          const text = data.response || "";
          if (signal.aborted) {
            cancelled = true;
            break;
          }

          // Parse tool calls
          const toolCalls = window.ChatreTools.parseToolCalls(text);
          const cleanText = window.ChatreTools.cleanResponseText(text);

          if (toolCalls.length === 0) {
            // Final response — no more tools needed.
            if (cleanText.trim()) {
              callbacks.onStepText && callbacks.onStepText(cleanText, true);
              fullAssistantText += (fullAssistantText ? "\n\n" : "") + cleanText;
            }
            if (!fullAssistantText) fullAssistantText = cleanText || "(no response)";
            callbacks.onDone && callbacks.onDone({ response: fullAssistantText, iterations: i + 1, cancelled: false });
            return { response: fullAssistantText, iterations: i + 1, cancelled: false, messages };
          }

          // Present the assistant's text (plan / progress)
          if (cleanText.trim()) {
            callbacks.onStepText && callbacks.onStepText(cleanText, false);
            fullAssistantText += (fullAssistantText ? "\n\n" : "") + cleanText;
          }

          // Append assistant message with tool calls to context
          messages.push({ role: "assistant", content: text });

          // Execute all tool calls in this response
          const results = [];
          for (const call of toolCalls) {
            if (signal.aborted) {
              cancelled = true;
              break;
            }
            callbacks.onToolStart && callbacks.onToolStart(call);
            const result = await window.ChatreTools.executeTool(call, {
              onWrite: (path, content) => {},
              onCommand: (cmd) => {},
            });
            results.push({
              tool: call.tool,
              params: call.params || {},
              result: serializeResult(result),
            });
            callbacks.onToolResult && callbacks.onToolResult(call, result);
          }

          if (cancelled) break;

          // Feed tool results back to the model
          messages.push({
            role: "user",
            content: "Tool execution results:\n" + JSON.stringify(results, null, 2) + "\n\nContinue with the next step. When the task is complete, give a final summary WITHOUT using tools.",
          });
        }

        if (!cancelled) {
          const msg = "I've reached my maximum step limit (" + this.maxIterations + " iterations). The task may need additional work. What would you like me to do next?";
          if (!fullAssistantText.includes("maximum step")) {
            callbacks.onStepText && callbacks.onStepText(msg, true);
            fullAssistantText += (fullAssistantText ? "\n\n" : "") + msg;
          }
          callbacks.onDone && callbacks.onDone({ response: fullAssistantText, iterations: this.maxIterations, cancelled: false });
          return { response: fullAssistantText, iterations: this.maxIterations, cancelled: false, messages };
        }

        callbacks.onDone && callbacks.onDone({ response: fullAssistantText || "(stopped)", iterations: this.iteration, cancelled: true });
        return { response: fullAssistantText || "(stopped)", iterations: this.iteration, cancelled: true, messages };
      } catch (error) {
        if (error && error.name === "AbortError") {
          callbacks.onDone && callbacks.onDone({ response: fullAssistantText || "(stopped)", iterations: this.iteration, cancelled: true });
          return { response: fullAssistantText || "(stopped)", iterations: this.iteration, cancelled: true, error };
        }
        callbacks.onError && callbacks.onError(error);
        const errMsg = "Agent error: " + (error.message || String(error));
        callbacks.onStepText && callbacks.onStepText(errMsg, true);
        fullAssistantText += (fullAssistantText ? "\n\n" : "") + errMsg;
        callbacks.onDone && callbacks.onDone({ response: fullAssistantText, iterations: this.iteration, cancelled: false, error });
        return { response: fullAssistantText, iterations: this.iteration, cancelled: false, error };
      } finally {
        this.running = false;
        this.abortController = null;
      }
    }
  }

  function serializeResult(result) {
    if (!result) return "null";
    const clone = Object.assign({}, result);
    if (result.output !== undefined && typeof result.output === "string" && result.output.length > 2000) {
      clone.output = result.output.slice(0, 2000) + "\n...[truncated]";
    }
    if (result.content !== undefined && typeof result.content === "string" && result.content.length > 2000) {
      clone.content = result.content.slice(0, 2000) + "\n...[truncated]";
    }
    if (result.ok === false && result.error) clone.error = String(result.error).slice(0, 1000);
    return clone;
  }

  function looksAgentic(text) {
    if (!text) return false;
    const t = String(text).toLowerCase();
    const patterns = [
      /^(?:please\s+)?(?:build|create|make|develop|implement|write|code|scaffold|set\s+up)\b/,
      /(?:build|create|make|develop|implement|write|code|scaffold)\b.{0,60}\b(?:app|application|project|website|web\s*app|program|tool|script|api|server|database|function|class|component)\b/,
      /\b(?:plan|refactor|optimize|debug|fix|test|review)\b.{0,60}\b(?:code|project|app|application|function|class|module|repo|repository)\b/,
      /\b(?:git\s+commit|commit and push|push\s+to\s+remote|create\s+a\s+repo|git\s+init)\b/,
      /\b(?:create|write|generate)\b.{0,40}\b(?:document|markdown|readme|file)\b/,
      /^(?:please\s+)?(?:write|generate)\s+(?:a\s+)?(?:python|javascript|js|html|css|sql|go|rust|java)\b/,
      /\b(?:add|implement|build|create|write)\b.{0,40}\b(?:feature|functionality|module|handler|endpoint|route|controller|service)\b/,
    ];
    return patterns.some((re) => re.test(t));
  }

  window.ChatreAgent = new AgentController();
  window.ChatreAgent.looksAgentic = looksAgentic;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = window.ChatreAgent;
  }
})();