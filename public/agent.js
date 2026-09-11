/**
 * Chatre Agent — thorough plan → skill → tool → verify loop.
 */
(function () {
  "use strict";

  const MAX_ITERATIONS = 25;
  const MAX_CONTEXT_TOKENS = 24000;

  // Read-only tools that are safe to run in parallel (no shared mutable state).
  const PARALLEL_SAFE = new Set([
    "read_file",
    "list_directory",
    "find_files",
    "search_code",
    "view_tree",
    "get_page_text",
    "search_web",
    "http_request",
    "git_status",
    "git_log",
    "list_skills",
    "verify_project",
  ]);

  // Tools that change the workspace → trigger the post-write verification gate.
  const MUTATING_TOOLS = new Set([
    "write_file",
    "append_file",
    "delete_file",
    "copy_file",
    "create_directory",
    "create_document",
  ]);

  // Tools that count as a verification step.
  const VERIFYING_TOOLS = new Set([
    "verify_project",
    "execute_command",
    "run_javascript",
    "run_python",
  ]);

  class AgentController {
    constructor() {
      this.maxIterations = MAX_ITERATIONS;
      this.running = false;
      this.abortController = null;
      this.iteration = 0;
      this.mutatedAny = false;
      this.verifiedAny = false;
      this.verifyNudged = false;
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
      this.mutatedAny = false;
      this.verifiedAny = false;
      this.verifyNudged = false;
      this.abortController = new AbortController();
      const signal = this.abortController.signal;
      const callbacks = (options && options.callbacks) || {};
      const model =
        (options && options.model) ||
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
      const maxTokens = (options && options.maxTokens) || 3072;

      const messages = (initialMessages || [])
        .filter((m) => m && m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content }));

      const lastUser =
        [...messages].reverse().find((m) => m.role === "user") || null;
      const autoSkills =
        (window.ChatreSkills &&
          window.ChatreSkills.detectSkills &&
          window.ChatreSkills.detectSkills(
            (lastUser && lastUser.content) || "",
          )) ||
        [];

      // Understand the request BEFORE doing anything: decide what kind of
      // task this is and expose only tools that fit (question → no file
      // writes; pdf/research → no mutations; build → full toolset).
      const intent =
        window.ChatreIntent && window.ChatreIntent.classifyIntent
          ? window.ChatreIntent.classifyIntent(
              (lastUser && lastUser.content) || "",
              autoSkills,
            )
          : null;

      const forcePlan =
        (options && options.forcePlan !== false) &&
        (!intent || intent.planFirst);

      // Real skill playbooks + intent-scoped tool availability, injected
      // every turn (includes the "understand first" instruction).
      const preamble = buildPreamble(autoSkills, intent);
      if (autoSkills.length && callbacks.onSkills) {
        callbacks.onSkills(autoSkills);
      }

      const enabledList =
        intent && intent.tools
          ? intent.tools
          : window.ChatreSkills && window.ChatreSkills.toolsForSkills
            ? window.ChatreSkills.toolsForSkills(autoSkills)
            : null;
      const enabledSet = enabledList ? new Set(enabledList) : null;

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

          const payloadMessages = preamble.concat(trimAgentMessages(messages));

          let text = "";
          const response = await fetch("/api/chat", {
            method: "POST",
            headers: window.ChatreCore.authHeaders(),
            signal,
            body: JSON.stringify({
              messages: payloadMessages,
              stream: true,
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

          const ct = response.headers.get("content-type") || "";
          // Tolerate a JSON response as a fallback, but we always stream.
          if (ct.includes("application/json")) {
            const data = await response.json();
            text = data.response || "";
            if (text && callbacks.onToken) callbacks.onToken(text, i + 1);
          } else if (ct.includes("text/event-stream") || ct.includes("stream")) {
            text = await readWorkerStream(response, signal, (delta) => {
              callbacks.onToken && callbacks.onToken(delta, i + 1);
            });
          } else {
            const data = await response.json();
            text = data.response || "";
            if (text && callbacks.onToken) callbacks.onToken(text, i + 1);
          }

          if (signal.aborted) {
            cancelled = true;
            break;
          }

          const toolCalls = window.ChatreTools.parseToolCalls(text);
          const cleanText = window.ChatreTools.cleanResponseText(text);

          if (toolCalls.length === 0) {
            // Nudge once if the model skipped planning/tools on a build task.
            // Never nudge a clarifying question — let the agent wait for the user.
            if (
              i === 0 &&
              forcePlan &&
              !planned &&
              usedTools === 0 &&
              !looksLikeClarification(cleanText)
            ) {
              messages.push({ role: "assistant", content: text || "(no tools yet)" });
              messages.push({
                role: "user",
                content:
                  "Continue with tools — do not stop yet.",
              });
              if (cleanText.trim()) {
                callbacks.onStepText && callbacks.onStepText(cleanText, false);
                fullAssistantText +=
                  (fullAssistantText ? "\n\n" : "") + cleanText;
              }
              continue;
            }

            // Post-write verification gate: files changed with zero verification.
            if (
              forcePlan &&
              this.mutatedAny &&
              !this.verifiedAny &&
              !this.verifyNudged &&
              i >= 1
            ) {
              this.verifyNudged = true;
              messages.push({ role: "assistant", content: text });
              messages.push({
                role: "user",
                content:
                  "You wrote files but verified nothing. Before finishing, verify: run verify_project, and tests / run_javascript / run_python / commands if appropriate. Then give the final summary WITHOUT tool blocks.",
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
            // Did the agent stop to ask a clarifying question (instead of
            // finishing the work)? Then the next user message is an ANSWER,
            // and we should continue this thread rather than start fresh.
            const askedClarification =
              !!intent &&
              !NO_CLARIFY_INTENTS.has(intent.name) &&
              usedTools === 0 &&
              !this.mutatedAny &&
              looksLikeClarification(cleanText);
            callbacks.onDone &&
              callbacks.onDone({
                response: fullAssistantText,
                iterations: i + 1,
                cancelled: false,
                toolsUsed: usedTools,
                intent: intent && intent.name,
                askedClarification,
              });
            return {
              response: fullAssistantText,
              iterations: i + 1,
              cancelled: false,
              messages,
              toolsUsed: usedTools,
              intent: intent && intent.name,
              askedClarification,
            };
          }

          if (cleanText.trim()) {
            callbacks.onStepText && callbacks.onStepText(cleanText, false);
            fullAssistantText += (fullAssistantText ? "\n\n" : "") + cleanText;
          }

          messages.push({ role: "assistant", content: text });

          const execOptions = {
            onWrite: function () {},
            onCommand: function () {},
            onDocument: function (path, content, title) {
              callbacks.onDocument &&
                callbacks.onDocument(path, content, title);
            },
          };

          // Skill-scoping enforcement: reject tools outside the allowlist so
          // the model learns to stay with file/shell/git tools on coding tasks.
          const runCall = async function (call) {
            if (enabledSet && !enabledSet.has(call.tool)) {
              return {
                ok: false,
                tool: call.tool,
                error:
                  "Tool is not enabled for this task. Enabled tools: " +
                  [...enabledSet].join(", ") +
                  ".",
              };
            }
            if (MUTATING_TOOLS.has(call.tool)) this.mutatedAny = true;
            if (VERIFYING_TOOLS.has(call.tool)) this.verifiedAny = true;
            return window.ChatreTools.executeTool(call, execOptions);
          }.bind(this);

          // Batch: parallel read-only group vs sequential mutating tools.
          const groups = [];
          let current = [];
          toolCalls.forEach(function (call) {
            if (PARALLEL_SAFE.has(call.tool)) {
              current.push(call);
            } else {
              if (current.length) {
                groups.push({ parallel: true, calls: current });
                current = [];
              }
              groups.push({ parallel: false, calls: [call] });
            }
          });
          if (current.length) groups.push({ parallel: true, calls: current });

          const results = [];
          for (const group of groups) {
            if (signal.aborted) {
              cancelled = true;
              break;
            }
            for (const call of group.calls) {
              if (call.tool === "plan") planned = true;
              usedTools += 1;
              callbacks.onToolStart && callbacks.onToolStart(call);
            }

            if (group.parallel) {
              const settled = await Promise.allSettled(
                group.calls.map((call) => runCall(call)),
              );
              settled.forEach((s, idx) => {
                if (signal.aborted) return;
                const call = group.calls[idx];
                const result =
                  s.status === "fulfilled"
                    ? s.value
                    : {
                        ok: false,
                        tool: call.tool,
                        error:
                          (s.reason && s.reason.message) || String(s.reason),
                      };
                results.push({
                  tool: call.tool,
                  params: summarizeParams(call.params),
                  result: serializeResult(result),
                });
                callbacks.onToolResult && callbacks.onToolResult(call, result);
              });
            } else {
              for (const call of group.calls) {
                if (signal.aborted) {
                  cancelled = true;
                  break;
                }
                const result = await runCall(call);
                results.push({
                  tool: call.tool,
                  params: summarizeParams(call.params),
                  result: serializeResult(result),
                });
                callbacks.onToolResult && callbacks.onToolResult(call, result);
              }
            }
          }

          if (cancelled) break;

          messages.push({
            role: "user",
            content:
              "Tool execution results (summarized if large):\n" +
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

  async function readWorkerStream(response, signal, onToken) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let carry = "";
    let full = "";
    while (true) {
      if (signal && signal.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      carry += decoder.decode(value, { stream: true });
      const lines = carry.split("\n");
      carry = lines.pop() || "";
      for (let line of lines) {
        line = line.trim();
        if (!line || line === "data: [DONE]" || line === "[DONE]") continue;
        if (line.startsWith("data:")) line = line.slice(5).trim();
        if (!line || line === "[DONE]") continue;
        try {
          const json = JSON.parse(line);
          const delta =
            typeof json.response === "string"
              ? json.response
              : typeof json.text === "string"
                ? json.text
                : typeof json.token === "string"
                  ? json.token
                  : "";
          if (delta) {
            full += delta;
            onToken && onToken(delta);
          }
        } catch {
          /* ignore */
        }
      }
    }
    return full;
  }

  function estimateTokens(text) {
    return Math.ceil(String(text || "").length / 4);
  }

  /**
   * Last real user instruction (skip "Tool execution results" system blocks).
   * This gets pinned so trimming never drops the user's actual request.
   */
  function currentUserRequest(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (
        m &&
        m.role === "user" &&
        typeof m.content === "string" &&
        !m.content.startsWith("Tool execution results")
      ) {
        return m;
      }
    }
    return messages && messages[0] ? messages[0] : null;
  }

  function trimAgentMessages(messages) {
    const request = currentUserRequest(messages);
    const tail = [];
    let total = request ? estimateTokens(request.content) + 4 : 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg === request) continue;
      const t = estimateTokens(msg.content) + 4;
      if (total + t > MAX_CONTEXT_TOKENS && tail.length >= 1) {
        break;
      }
      total += t;
      tail.unshift(msg);
    }
    const out = request ? [request] : [];
    const dropped = messages.length - (request ? 1 : 0) - tail.length;
    if (dropped > 0) {
      out.push({
        role: "user",
        content:
          "[Context compressed: earlier steps and tool transcripts were summarized/truncated to fit the model window. Continue from the plan, latest tool outputs, and remaining todos.]",
      });
    }
    return out.concat(tail);
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
    const soft = 1800;
    const keep = 850;
    ["output", "content", "text", "guide"].forEach((key) => {
      if (typeof clone[key] === "string" && clone[key].length > soft) {
        // Preserve the tail: build errors / stderr appear at the END.
        clone[key] =
          clone[key].slice(0, keep) +
          "\n…[truncated " +
          result[key].length +
          " chars]…\n" +
          clone[key].slice(-keep);
      }
    });
    if (result.ok === false && result.error) {
      clone.error = String(result.error).slice(0, 1000);
    }
    return clone;
  }

  /**
   * Build per-turn prefix messages: an "understand first" framing, the
   * intent-scoped task description, skill playbooks, and the list of
   * enabled tools so the model knows exactly what it may do.
   */
  function buildPreamble(skills, intent) {
    const parts = [];
    const enabled =
      intent && intent.tools
        ? intent.tools
        : window.ChatreSkills && window.ChatreSkills.toolsForSkills
          ? window.ChatreSkills.toolsForSkills(skills || [])
          : [];

    // 1. Understand before act
    parts.push(
      "# Understand the user's request first\n" +
        '- Before using ANY tool, restate your understanding of the request in 1–3 sentences, starting with "My understanding:". Say what the user is asking for, the expected outcome, and any constraints you know.\n' +
        "- If the request is ambiguous or key details are missing, ask ONE short clarifying question and STOP. Do not guess and do not call tools yet.\n" +
        "- You may inspect the workspace (read-only) or search the web first to answer anything you can find yourself, before asking the user.\n" +
        "- Never start implementing, writing files, or running commands on a vague or underspecified request.",
    );

    // 2. Intent-aware task framing
    if (intent) {
      parts.push(
        "## Task type: " +
          intent.name.toUpperCase() +
          "\n" +
          "The user's message requires " +
          intent.label +
          ".\n" +
          (intent.mutative
            ? "This task may modify files or run commands — plan, implement, and verify.\n"
            : "This task must NOT modify files or run commands. Keep it read-only; answer directly.\n") +
          "Enabled tools for this task: " +
          (enabled.length
            ? enabled.join(", ")
            : "(none — answer directly without tools)") +
          ".\n" +
          "Calls to any other tool will be rejected — pick from the enabled list only.",
      );
    }

    // 3. Full skill playbooks (real workflow guidance)
    const known = (skills || []).filter(function (name) {
      return window.ChatreSkills && window.ChatreSkills.getSkill(name);
    });
    if (known.length) {
      parts.push("# Task context — apply these skill playbooks");
      known.forEach(function (name) {
        const skill = window.ChatreSkills.getSkill(name);
        parts.push(
          window.ChatreSkills.formatSkill
            ? window.ChatreSkills.formatSkill(skill)
            : name,
        );
      });
    }

    return parts.length
      ? [{ role: "user", content: parts.join("\n\n") }]
      : [];
  }

  // Intents where a plain final answer is NOT a clarifying question.
  const NO_CLARIFY_INTENTS = new Set(["chat", "question"]);

  /**
   * Detect whether the model ended without tools by asking the user a short
   * question instead of completing the work.  The client marks the run as
   * "awaiting reply" so the next user message automatically resumes this
   * thread instead of starting a fresh one.
   */
  function looksLikeClarification(text) {
    const t = String(text || "").trim();
    if (!t || t.length > 700) return false;
    if (/```/.test(t)) return false;
    return /[?？]/.test(t);
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
