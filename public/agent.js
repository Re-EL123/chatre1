/**
 * Chatre Agent — thorough plan → skill → tool → verify loop.
 */
(function () {
  "use strict";

  const MAX_ITERATIONS = 25;
  const MAX_CONTEXT_TOKENS = 7000;

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
     * @param {Array} initialMessages
     * @param {Object} options { model, maxTokens, callbacks, forcePlan }
     */
    async run(initialMessages, options) {
      if (this.running) return { response: "", cancelled: true };
      this.running = true;
      this.iteration = 0;
      this.abortController = new AbortController();
      const signal = this.abortController.signal;
      const callbacks = (options && options.callbacks) || {};
      const model =
        (options && options.model) ||
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
      const maxTokens = (options && options.maxTokens) || 3072;
      const forcePlan = options && options.forcePlan !== false;

      const messages = (initialMessages || [])
        .filter((m) => m && m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content }));

      // Kick off with an explicit agent brief so the model plans thoroughly.
      if (forcePlan) {
        messages.push({
          role: "user",
          content:
            "AGENT BRIEF: You are in full agent mode. Be skilled and thorough.\n" +
            "1) Call list_skills or use_skill if helpful.\n" +
            "2) Call plan with concrete steps.\n" +
            "3) Inspect the workspace before writing files.\n" +
            "4) Implement completely, verify, document, and commit/push when asked.\n" +
            "Use ```tool JSON blocks for every tool. Begin now.",
        });
      }

      let fullAssistantText = "";
      let cancelled = false;
      let planned = false;
      let usedTools = 0;

      try {
        for (let i = 0; i < this.maxIterations; i++) {
          this.iteration = i + 1;
          if (signal.aborted) {
            cancelled = true;
            break;
          }

          callbacks.onThinking &&
            callbacks.onThinking(i + 1, this.maxIterations);

          const payloadMessages = trimAgentMessages(messages);

          const response = await fetch("/api/chat", {
            method: "POST",
            headers: window.ChatreCore.authHeaders(),
            signal,
            body: JSON.stringify({
              messages: payloadMessages,
              stream: false,
              agent: true,
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

          const toolCalls = window.ChatreTools.parseToolCalls(text);
          const cleanText = window.ChatreTools.cleanResponseText(text);

          if (toolCalls.length === 0) {
            // Nudge once if the model skipped planning/tools on a build task.
            if (i === 0 && forcePlan && !planned && usedTools === 0) {
              messages.push({ role: "assistant", content: text || "(no tools yet)" });
              messages.push({
                role: "user",
                content:
                  "You have not used tools yet. Start with a plan tool call, then use_skill if useful, then implement with write_file / execute_command. Do not finish yet.",
              });
              if (cleanText.trim()) {
                callbacks.onStepText && callbacks.onStepText(cleanText, false);
                fullAssistantText +=
                  (fullAssistantText ? "\n\n" : "") + cleanText;
              }
              continue;
            }

            if (cleanText.trim()) {
              callbacks.onStepText && callbacks.onStepText(cleanText, true);
              fullAssistantText +=
                (fullAssistantText ? "\n\n" : "") + cleanText;
            }
            if (!fullAssistantText) {
              fullAssistantText = cleanText || "(no response)";
            }
            callbacks.onDone &&
              callbacks.onDone({
                response: fullAssistantText,
                iterations: i + 1,
                cancelled: false,
                toolsUsed: usedTools,
              });
            return {
              response: fullAssistantText,
              iterations: i + 1,
              cancelled: false,
              messages,
              toolsUsed: usedTools,
            };
          }

          if (cleanText.trim()) {
            callbacks.onStepText && callbacks.onStepText(cleanText, false);
            fullAssistantText += (fullAssistantText ? "\n\n" : "") + cleanText;
          }

          messages.push({ role: "assistant", content: text });

          const results = [];
          for (const call of toolCalls) {
            if (signal.aborted) {
              cancelled = true;
              break;
            }
            if (call.tool === "plan") planned = true;
            usedTools += 1;
            callbacks.onToolStart && callbacks.onToolStart(call);
            const result = await window.ChatreTools.executeTool(call, {
              onWrite: function () {},
              onCommand: function () {},
              onDocument: function (path, content, title) {
                callbacks.onDocument &&
                  callbacks.onDocument(path, content, title);
              },
            });
            results.push({
              tool: call.tool,
              params: summarizeParams(call.params),
              result: serializeResult(result),
            });
            callbacks.onToolResult && callbacks.onToolResult(call, result);
          }

          if (cancelled) break;

          messages.push({
            role: "user",
            content:
              "Tool execution results:\n" +
              JSON.stringify(results, null, 2) +
              "\n\nContinue thoroughly. If more work remains, use tools. " +
              "When the task is complete: verify if needed, then give a final summary WITHOUT tool blocks.",
          });
        }

        if (!cancelled) {
          const msg =
            "Reached the maximum agent step limit (" +
            this.maxIterations +
            "). Tell me what to continue with.";
          callbacks.onStepText && callbacks.onStepText(msg, true);
          fullAssistantText += (fullAssistantText ? "\n\n" : "") + msg;
          callbacks.onDone &&
            callbacks.onDone({
              response: fullAssistantText,
              iterations: this.maxIterations,
              cancelled: false,
              toolsUsed: usedTools,
            });
          return {
            response: fullAssistantText,
            iterations: this.maxIterations,
            cancelled: false,
            messages,
            toolsUsed: usedTools,
          };
        }

        callbacks.onDone &&
          callbacks.onDone({
            response: fullAssistantText || "(stopped)",
            iterations: this.iteration,
            cancelled: true,
            toolsUsed: usedTools,
          });
        return {
          response: fullAssistantText || "(stopped)",
          iterations: this.iteration,
          cancelled: true,
          messages,
          toolsUsed: usedTools,
        };
      } catch (error) {
        if (error && error.name === "AbortError") {
          callbacks.onDone &&
            callbacks.onDone({
              response: fullAssistantText || "(stopped)",
              iterations: this.iteration,
              cancelled: true,
              toolsUsed: usedTools,
            });
          return {
            response: fullAssistantText || "(stopped)",
            iterations: this.iteration,
            cancelled: true,
            error,
            toolsUsed: usedTools,
          };
        }
        callbacks.onError && callbacks.onError(error);
        const errMsg = "Agent error: " + (error.message || String(error));
        callbacks.onStepText && callbacks.onStepText(errMsg, true);
        fullAssistantText += (fullAssistantText ? "\n\n" : "") + errMsg;
        callbacks.onDone &&
          callbacks.onDone({
            response: fullAssistantText,
            iterations: this.iteration,
            cancelled: false,
            error,
            toolsUsed: usedTools,
          });
        return {
          response: fullAssistantText,
          iterations: this.iteration,
          cancelled: false,
          error,
          toolsUsed: usedTools,
        };
      } finally {
        this.running = false;
        this.abortController = null;
      }
    }
  }

  function estimateTokens(text) {
    return Math.ceil(String(text || "").length / 4);
  }

  function trimAgentMessages(messages) {
    let total = 0;
    const kept = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const t = estimateTokens(msg.content) + 4;
      if (total + t > MAX_CONTEXT_TOKENS && kept.length > 2) break;
      total += t;
      kept.unshift(msg);
    }
    return kept;
  }

  function summarizeParams(params) {
    if (!params || typeof params !== "object") return {};
    const out = {};
    Object.keys(params).forEach((k) => {
      const v = params[k];
      if (typeof v === "string" && v.length > 400) {
        out[k] = v.slice(0, 400) + "…[truncated " + v.length + " chars]";
      } else {
        out[k] = v;
      }
    });
    return out;
  }

  function serializeResult(result) {
    if (!result) return "null";
    const clone = Object.assign({}, result);
    if (
      result.output !== undefined &&
      typeof result.output === "string" &&
      result.output.length > 2500
    ) {
      clone.output = result.output.slice(0, 2500) + "\n...[truncated]";
    }
    if (
      result.content !== undefined &&
      typeof result.content === "string" &&
      result.content.length > 2500
    ) {
      clone.content = result.content.slice(0, 2500) + "\n...[truncated]";
    }
    if (result.guide && typeof result.guide === "string" && result.guide.length > 2000) {
      clone.guide = result.guide.slice(0, 2000) + "\n...[truncated]";
    }
    if (result.ok === false && result.error) {
      clone.error = String(result.error).slice(0, 1000);
    }
    return clone;
  }

  function looksAgentic(text) {
    if (!text) return false;
    const t = String(text).toLowerCase();
    const patterns = [
      /^(?:please\s+)?(?:build|create|make|develop|implement|write|code|scaffold|set\s+up|plan|refactor|fix|debug|test)\b/,
      /(?:build|create|make|develop|implement|write|code|scaffold)\b.{0,80}\b(?:app|application|project|website|web\s*app|program|tool|script|api|server|database|function|class|component|document|readme)\b/,
      /\b(?:git\s+commit|commit and push|push\s+to\s+remote|create\s+a\s+repo|git\s+init|git\s+push)\b/,
      /\b(?:create|write|generate)\b.{0,40}\b(?:document|markdown|readme|file|folder|directory)\b/,
      /^(?:please\s+)?(?:write|generate)\s+(?:a\s+)?(?:python|javascript|js|html|css|sql|go|rust|java|typescript|ts)\b/,
      /\b(?:add|implement|build|create|write)\b.{0,40}\b(?:feature|functionality|module|handler|endpoint|route|controller|service)\b/,
      /\b(?:run|execute)\b.{0,30}\b(?:command|script|test|tests|build)\b/,
      /\bagent\b/,
    ];
    return patterns.some((re) => re.test(t));
  }

  window.ChatreAgent = new AgentController();
  window.ChatreAgent.looksAgentic = looksAgentic;
})();
