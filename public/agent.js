/**
 * Chatre Agent — thorough plan → skill → tool → verify loop.
 */
(function () {
  "use strict";

  const MAX_ITERATIONS = 25;
  const MAX_CONTEXT_TOKENS = 24000;

  function localProjectSlug(text) {
    const raw = String(text || "project")
      .toLowerCase()
      .replace(
        /\b(design|create|make|build|me|a|an|the|in|with|using|html|css|js|javascript)\b/g,
        " ",
      )
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    return raw || "project";
  }

  function extractLocalProjectFiles(text) {
    const src = String(text || "");
    const out = [];
    const seen = {};
    function add(rel, content) {
      const path = String(rel || "")
        .replace(/^\/+/, "")
        .replace(/^home\/user\/projects\/[^/]+\//, "")
        .trim();
      const body = String(content || "").trim();
      if (!path || !body || body.length < 8 || seen[path]) return;
      seen[path] = true;
      out.push({ relativePath: path, content: body });
    }
    const fenceRe = /```(\w+)?([^\n]*)\n([\s\S]*?)```/g;
    let m;
    while ((m = fenceRe.exec(src))) {
      const lang = String(m[1] || "").toLowerCase();
      const meta = String(m[2] || "").trim();
      const body = m[3];
      let rel = "";
      const pathEq = meta.match(/(?:path|file)\s*[=:]\s*([^\s]+)/i);
      if (pathEq) rel = pathEq[1];
      else if (/\.(html?|css|js)$/i.test(meta)) rel = meta.split(/\s+/).pop();
      else if (lang === "html" || /<!DOCTYPE|<html[\s>]/i.test(body)) {
        rel = "index.html";
      } else if (lang === "css") rel = "style.css";
      else if (lang === "js" || lang === "javascript") rel = "script.js";
      if (rel) add(rel.replace(/^["']|["']$/g, ""), body);
    }
    return out;
  }

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
    "search_mcp_registry",
    "list_mcp_tools",
  ]);

  // Tools that change the workspace → trigger the post-write verification gate.
  const MUTATING_TOOLS = new Set([
    "write_file",
    "append_file",
    "delete_file",
    "copy_file",
    "create_directory",
    "create_document",
    "create_pdf",
    "patch_file",
    "apply_patch",
    "image_generate",
    "text_to_speech",
  ]);

  // Tools that count as a verification step.
  const VERIFYING_TOOLS = new Set([
    "verify_project",
    "execute_command",
    "execute_code",
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
      const userText = (lastUser && lastUser.content) || "";
      let autoSkills =
        (window.ChatreSkills &&
          window.ChatreSkills.detectSkills &&
          window.ChatreSkills.detectSkills(userText)) ||
        [];
      const detectedAll = autoSkills.slice();
      if (autoSkills.length && window.ChatreSkills.composeActiveSkills) {
        autoSkills = window.ChatreSkills.composeActiveSkills(
          autoSkills,
          null,
          userText,
        );
      } else if (autoSkills.length && window.ChatreSkills.pickPrimarySkill) {
        autoSkills = window.ChatreSkills.pickPrimarySkill(autoSkills, null);
      }

      if (autoSkills.length && callbacks.onSkills) {
        callbacks.onSkills(autoSkills);
      }

      // ── Analyst phase: tailor a brief for THIS request ──
      callbacks.onPhase && callbacks.onPhase("analyze", "Analyzing request…");
      let briefing = null;
      try {
        if (window.ChatreAnalyst && window.ChatreAnalyst.runAnalysis) {
          briefing = await window.ChatreAnalyst.runAnalysis(userText, {
            model: model,
            signal: signal,
            history: messages.slice(0, -1),
          });
        }
      } catch (err) {
        briefing = null;
      }
      if (!briefing) {
        briefing = window.ChatreAnalyst
          ? window.ChatreAnalyst.normalizeBriefing(null, userText)
          : {
              understanding: "",
              goal: userText.slice(0, 200),
              task_type: "mixed",
              success_criteria: [],
              approach: [],
              todos: [],
              tools_priority: [],
              do_not: [],
              constraints: [],
              needs_clarification: false,
              clarification_question: "",
              executor_brief:
                "Complete the user request thoroughly. Match tools to the request — do not use a generic script.",
            };
        if (!briefing.executor_brief) {
          briefing.executor_brief =
            "Complete the user request thoroughly. Match tools to the request — do not use a generic script.";
        }
      }

      // Starter-chip template seed (Research / Build / Fill form).
      if (window.__pendingTemplateBriefing) {
        const seeded = window.__pendingTemplateBriefing;
        window.__pendingTemplateBriefing = null;
        briefing = Object.assign({}, seeded, briefing, {
          understanding:
            String(briefing.understanding || "").trim() || seeded.understanding,
          goal: String(briefing.goal || "").trim() || seeded.goal,
          task_type: briefing.task_type || seeded.task_type,
          success_criteria:
            briefing.success_criteria && briefing.success_criteria.length
              ? briefing.success_criteria
              : seeded.success_criteria,
          approach:
            briefing.approach && briefing.approach.length
              ? briefing.approach
              : seeded.approach,
          todos:
            briefing.todos && briefing.todos.length
              ? briefing.todos
              : seeded.todos,
          tools_priority:
            briefing.tools_priority && briefing.tools_priority.length
              ? briefing.tools_priority
              : seeded.tools_priority,
          executor_brief:
            String(briefing.executor_brief || "").trim() ||
            seeded.executor_brief,
          template_id: seeded.template_id || briefing.template_id,
        });
      }

      // Fill blank analyst output from plan templates (same as API enrichBriefing).
      const sparse =
        !(
          String(briefing.understanding || "").trim() ||
          String(briefing.executor_brief || "").trim()
        ) ||
        !(
          (briefing.approach && briefing.approach.length) ||
          (briefing.todos && briefing.todos.length)
        );
      if (
        sparse &&
        window.ChatrePlanTemplates &&
        window.ChatrePlanTemplates.briefingFromTemplate
      ) {
        const type = String(briefing.task_type || "").toLowerCase();
        const map = {
          research: "research",
          browser: "fill-form",
          build: "build",
          debug: "build",
          git: "build",
          run: "build",
          mixed: "build",
          document: "document",
        };
        const tid = briefing.template_id || map[type];
        if (tid) {
          const seeded = window.ChatrePlanTemplates.briefingFromTemplate(
            tid,
            briefing.goal || userText,
          );
          if (seeded) {
            briefing = Object.assign({}, seeded, briefing, {
              understanding:
                String(briefing.understanding || "").trim() ||
                seeded.understanding,
              executor_brief:
                String(briefing.executor_brief || "").trim() ||
                seeded.executor_brief,
              approach:
                briefing.approach && briefing.approach.length
                  ? briefing.approach
                  : seeded.approach,
              todos:
                briefing.todos && briefing.todos.length
                  ? briefing.todos
                  : seeded.todos,
              success_criteria:
                briefing.success_criteria && briefing.success_criteria.length
                  ? briefing.success_criteria
                  : seeded.success_criteria,
              tools_priority:
                briefing.tools_priority && briefing.tools_priority.length
                  ? briefing.tools_priority
                  : seeded.tools_priority,
            });
          }
        }
      }
      if (!String(briefing.understanding || "").trim()) {
        briefing.understanding = "Execute the user request directly.";
      }
      if (!String(briefing.executor_brief || "").trim()) {
        briefing.executor_brief =
          "Complete the user request thoroughly. Match tools to the request — do not use a generic script.";
      }

      if (!briefing.done_when) {
        briefing.done_when =
          briefing.task_type === "document"
            ? "File exists under /home/user/documents from create_pdf or create_document"
            : (briefing.success_criteria && briefing.success_criteria[0]) ||
              "Goal completed with workspace evidence";
      }
      if (
        detectedAll.length &&
        window.ChatreSkills &&
        window.ChatreSkills.composeActiveSkills
      ) {
        autoSkills = window.ChatreSkills.composeActiveSkills(
          detectedAll,
          briefing.task_type,
          userText,
        );
        if (callbacks.onSkills) callbacks.onSkills(autoSkills);
      } else if (
        autoSkills.length &&
        window.ChatreSkills &&
        window.ChatreSkills.pickPrimarySkill
      ) {
        autoSkills = window.ChatreSkills.pickPrimarySkill(
          autoSkills,
          briefing.task_type,
        );
        if (callbacks.onSkills) callbacks.onSkills(autoSkills);
      }

      callbacks.onAnalysis && callbacks.onAnalysis(briefing);

      const isLightLocal =
        briefing.task_type === 'chat' ||
        (briefing.task_type === 'question' &&
          (!briefing.todos || !briefing.todos.length));
      if (
        !isLightLocal &&
        options &&
        options.skipPlanApproval !== true &&
        !(
          window.ChatreAutonomy &&
          window.ChatreAutonomy.shouldSkipPlanApproval &&
          window.ChatreAutonomy.shouldSkipPlanApproval(briefing.task_type)
        ) &&
        typeof callbacks.onAwaitPlan === "function"
      ) {
        const edited = await callbacks.onAwaitPlan(briefing);
        if (edited === null || edited === false) {
          this.running = false;
          return { response: '', cancelled: true, planCancelled: true };
        }
        if (edited && typeof edited === 'object') {
          briefing = edited;
        }
      }


      if (briefing.needs_clarification && briefing.clarification_question) {
        const q = briefing.clarification_question;
        callbacks.onStepText && callbacks.onStepText(q, true);
        callbacks.onDone &&
          callbacks.onDone({
            response: q,
            iterations: 0,
            cancelled: false,
            toolsUsed: 0,
            clarification: true,
          });
        this.running = false;
        return {
          response: q,
          iterations: 0,
          cancelled: false,
          clarification: true,
        };
      }

      // Heuristic intent still scopes which tools are allowed.
      const intent =
        window.ChatreIntent && window.ChatreIntent.classifyIntent
          ? window.ChatreIntent.classifyIntent(userText, autoSkills)
          : null;

      if (briefing.max_steps) {
        this.maxIterations = Math.min(
          this.maxIterations,
          Number(briefing.max_steps) || this.maxIterations,
        );
      }

      const forcePlan =
        (options && options.forcePlan !== false) &&
        ["build", "debug", "document", "git", "run"].indexOf(
          briefing.task_type,
        ) !== -1;

      const role =
        window.ChatreSubagents && window.ChatreSubagents.subagentPrompt
          ? window.ChatreSubagents.subagentPrompt(briefing.task_type)
          : null;
      if (role) {
        callbacks.onStepText &&
          callbacks.onStepText("Executor: " + (role.label || role.name), false);
      }

      let executorOrders =
        window.ChatreAnalyst && window.ChatreAnalyst.formatExecutorPrompt
          ? window.ChatreAnalyst.formatExecutorPrompt(briefing, userText)
          : "";
      if (role && role.prompt) {
        executorOrders =
          "## Role\n" + role.prompt + "\n\n" + (executorOrders || "");
      }

      // Slim skill context + analyst orders (not a generic workflow dump).
      const preamble = buildPreamble(autoSkills, intent, executorOrders, userText);

      const enabledList =
        intent && intent.tools
          ? intent.tools
          : window.ChatreSkills && window.ChatreSkills.toolsForSkills
            ? window.ChatreSkills.toolsForSkills(autoSkills)
            : null;
      const enabledSet = enabledList ? new Set(enabledList) : null;

      // Seed todos from the analyst when present.
      if (
        briefing.todos &&
        briefing.todos.length &&
        window.ChatreTools &&
        window.ChatreTools.executeTool
      ) {
        try {
          await window.ChatreTools.executeTool({
            tool: "todo_write",
            params: { todos: briefing.todos },
          });
        } catch (e) {
          /* ignore */
        }
      }

      callbacks.onPhase && callbacks.onPhase("execute", "Executing brief…");

      let fullAssistantText = "";
      let cancelled = false;
      let planned = !!briefing.approach.length || !!briefing.todos.length;
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

          if (
            Array.isArray(window.__pendingGuidance) &&
            window.__pendingGuidance.length
          ) {
            window.__pendingGuidance.splice(0).forEach(function (g) {
              messages.push({ role: "user", content: g });
            });
          }

          // Pace non-first iterations so tool rounds don't burst all of the
          // minute's AI requests at once (Workers AI has per-minute caps).
          if (i > 0) {
            await new Promise((resolve) => setTimeout(resolve, 600));
          }

          const payloadMessages = preamble.concat(trimAgentMessages(messages));

          const modelName = String(model || "");
          if (/^(openrouter|anthropic|openai|google):/i.test(modelName)) {
            throw new Error(
              "BYOK model " +
                modelName +
                " cannot run on the local Worker. Sign in so the remote agent API can use your OpenRouter key.",
            );
          }

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
            if (response.status === 429) {
              errMsg =
                errMsg +
                " Workers AI free quota may be exhausted (or rate-limited). Wait a minute, or add a BYOK key in Settings.";
              const ra = response.headers.get("Retry-After");
              if (ra) errMsg += " Retry-After: " + ra + "s.";
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
                  "[internal] Continue with tools for this task — do not stop yet. For builds use write_file under /home/user/projects/<slug>/ — never Python open()/zipfile. Do not narrate this message.",
              });
              if (cleanText.trim()) {
                callbacks.onStepText && callbacks.onStepText(cleanText, false);
                fullAssistantText +=
                  (fullAssistantText ? "\n\n" : "") + cleanText;
              }
              continue;
            }

            // Block chat-only "I saved the files" theatre — repeat until writes land
            const deliveryNudges = Number(this._forcedDeliveryNudge || 0);
            if (
              forcePlan &&
              !this.mutatedAny &&
              deliveryNudges < 4 &&
              i < this.maxIterations - 1 &&
              !looksLikeClarification(cleanText)
            ) {
              // Salvage fenced code the model already dumped into chat
              const salvaged = extractLocalProjectFiles(
                (fullAssistantText || "") + "\n" + (text || ""),
              );
              if (salvaged.length && window.ChatreTools && window.ChatreTools.executeTool) {
                const slug = localProjectSlug(userText || (briefing && briefing.goal));
                const root = "/home/user/projects/" + slug;
                await window.ChatreTools.executeTool(
                  { tool: "create_directory", params: { path: root } },
                  {},
                );
                let wrote = 0;
                for (let si = 0; si < salvaged.length; si++) {
                  const f = salvaged[si];
                  const path = root + "/" + f.relativePath;
                  const wr = await window.ChatreTools.executeTool(
                    {
                      tool: "write_file",
                      params: { path: path, content: f.content },
                    },
                    {},
                  );
                  if (wr && wr.ok !== false) {
                    wrote += 1;
                    this.mutatedAny = true;
                    usedTools += 1;
                    callbacks.onToolResult &&
                      callbacks.onToolResult(
                        { tool: "write_file", params: { path: path } },
                        wr,
                      );
                  }
                }
                if (wrote) {
                  const msg =
                    "Created project files in your workspace under `" +
                    root +
                    "` (" +
                    wrote +
                    " files). Open them from the Files panel.";
                  callbacks.onStepText && callbacks.onStepText(msg, true);
                  fullAssistantText += (fullAssistantText ? "\n\n" : "") + msg;
                  callbacks.onDone &&
                    callbacks.onDone({
                      response: fullAssistantText,
                      iterations: i + 1,
                      cancelled: false,
                      toolsUsed: usedTools,
                      intent: intent && intent.name,
                    });
                  return {
                    response: fullAssistantText,
                    iterations: i + 1,
                    cancelled: false,
                    messages,
                    toolsUsed: usedTools,
                    intent: intent && intent.name,
                  };
                }
              }

              this._forcedDeliveryNudge = deliveryNudges + 1;
              messages.push({ role: "assistant", content: text || "" });
              messages.push({
                role: "user",
                content:
                  "[internal] No workspace files were created yet (nudge " +
                  this._forcedDeliveryNudge +
                  "). Chat dumps do NOT save files. Immediately call write_file with FULL contents under /home/user/projects/<slug>/index.html (and style.css, script.js). Then list_directory. Never invent Download links.",
              });
              // Do not show lying "Writing files…" essays to the user
              if (
                cleanText.trim() &&
                !/writing (files|index\.html)|files have been created|successfully created/i.test(
                  cleanText,
                )
              ) {
                callbacks.onStepText && callbacks.onStepText(cleanText, false);
                fullAssistantText +=
                  (fullAssistantText ? "\n\n" : "") + cleanText;
              } else {
                callbacks.onPhase &&
                  callbacks.onPhase("tool", "Writing real files into the workspace…");
              }
              continue;
            }

            // Never finish a build/document with zero writes — honest failure
            if (
              forcePlan &&
              !this.mutatedAny &&
              i >= this.maxIterations - 1 &&
              !looksLikeClarification(cleanText)
            ) {
              const fail =
                "I could not write project files into the workspace. Nothing was saved under /home/user/projects/. Please try again.";
              callbacks.onStepText && callbacks.onStepText(fail, true);
              fullAssistantText = fail;
              callbacks.onDone &&
                callbacks.onDone({
                  response: fail,
                  iterations: i + 1,
                  cancelled: false,
                  toolsUsed: usedTools,
                  intent: intent && intent.name,
                });
              return {
                response: fail,
                iterations: i + 1,
                cancelled: false,
                messages,
                toolsUsed: usedTools,
                intent: intent && intent.name,
              };
            }

            // Post-write verification gate: files changed with zero verification.
            if (
              forcePlan &&
              this.mutatedAny &&
              !this.verifiedAny &&
              !this.verifyNudged &&
              i >= 1 &&
              (briefing && briefing.task_type) !== "document"
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

            // Document/PDF: require a real create_pdf / create_document before finishing.
            if (
              forcePlan &&
              briefing &&
              briefing.task_type === "document" &&
              !this.mutatedAny &&
              i < this.maxIterations - 1 &&
              !looksLikeClarification(cleanText)
            ) {
              messages.push({ role: "assistant", content: text || "(no file yet)" });
              messages.push({
                role: "user",
                content:
                  "[internal] Deliver the file now with create_pdf(title, content) or create_document(title, content). Do not claim a download exists until the tool returns ok. Do not narrate this message.",
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
            taskType: briefing && briefing.task_type,
            toolsPriority: briefing && briefing.tools_priority,
            onWrite: function (path) {
              const entry =
                window.ChatreCore &&
                window.ChatreCore.fs &&
                window.ChatreCore.fs[path];
              if (entry && window.ChatrePanels && window.ChatrePanels.state) {
                window.ChatrePanels.state.files[path] = Object.assign(
                  {},
                  entry,
                  { path: path },
                );
              } else if (
                window.ChatrePanels &&
                window.ChatrePanels.rememberWrite
              ) {
                window.ChatrePanels.rememberWrite(
                  path,
                  null,
                  arguments[1],
                );
              }
              if (window.ChatrePanels && window.ChatrePanels.refreshFiles) {
                window.ChatrePanels.refreshFiles();
              }
            },
            onCommand: function () {},
            onDocument: function (path, content, title) {
              const entry =
                window.ChatreCore &&
                window.ChatreCore.fs &&
                window.ChatreCore.fs[path];
              if (entry && window.ChatrePanels && window.ChatrePanels.state) {
                window.ChatrePanels.state.files[path] = Object.assign(
                  {},
                  entry,
                  { path: path },
                );
              } else if (
                window.ChatrePanels &&
                window.ChatrePanels.rememberWrite
              ) {
                window.ChatrePanels.rememberWrite(path, null, content);
              }
              if (window.ChatrePanels && window.ChatrePanels.refreshFiles) {
                window.ChatrePanels.refreshFiles();
              }
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

          // Terminal elicitation/connector tools: stop the loop so the
          // UI can render tappable option buttons or connector cards.
          const specialResult = results.find(function (r) {
            return r.result && (r.result.type === "user_input" || r.result.type === "connectors");
          });
          if (specialResult) {
            const payload = specialResult.result;
            callbacks.onDone &&
              callbacks.onDone({
                response: fullAssistantText,
                iterations: i + 1,
                cancelled: false,
                toolsUsed: usedTools,
                intent: intent && intent.name,
                askedClarification: true,
                userInput: payload.type === "user_input" ? payload : null,
                suggestedConnectors: payload.type === "connectors" ? payload : null,
              });
            return {
              response: fullAssistantText,
              iterations: i + 1,
              cancelled: false,
              messages,
              toolsUsed: usedTools,
              intent: intent && intent.name,
              askedClarification: true,
              userInput: payload.type === "user_input" ? payload : null,
              suggestedConnectors: payload.type === "connectors" ? payload : null,
            };
          }

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
    const scrubbed = (messages || []).filter(function (m) {
      if (!m || !m.content) return true;
      if (window.ChatreTools && window.ChatreTools.isSteerNoise) {
        return !window.ChatreTools.isSteerNoise(m.content);
      }
      const t = String(m.content).trim();
      return !(
        /^\[internal\]/i.test(t) ||
        /^Continue:\s*/i.test(t) ||
        /^Continue with tools/i.test(t)
      );
    });
    const request = currentUserRequest(scrubbed);
    const tail = [];
    let total = request ? estimateTokens(request.content) + 4 : 0;
    for (let i = scrubbed.length - 1; i >= 0; i--) {
      const msg = scrubbed[i];
      if (msg === request) continue;
      const t = estimateTokens(msg.content) + 4;
      if (total + t > MAX_CONTEXT_TOKENS && tail.length >= 1) {
        break;
      }
      total += t;
      tail.unshift(msg);
    }
    const out = request ? [request] : [];
    const dropped = scrubbed.length - (request ? 1 : 0) - tail.length;
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
    if (clone.screenshot_base64) {
      clone.hasScreenshot = true;
      delete clone.screenshot_base64;
    }
    if (clone.screenshot_ui) {
      clone.hasScreenshot = true;
      delete clone.screenshot_ui;
    }
    if (clone.screenshot_preview) {
      clone.hasScreenshot = true;
      delete clone.screenshot_preview;
    }
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
  function buildPreamble(skills, intent, executorOrders, userText) {
    const parts = [];
    const enabled =
      intent && intent.tools
        ? intent.tools
        : window.ChatreSkills && window.ChatreSkills.toolsForSkills
          ? window.ChatreSkills.toolsForSkills(skills || [])
          : [];

    // Analyst orders first — this is the task-specific prompt for the executor.
    if (executorOrders && String(executorOrders).trim()) {
      parts.push(String(executorOrders).trim());
    }

    if (intent) {
      parts.push(
        "## Enabled tools for this task\n" +
          (enabled.length
            ? enabled.join(", ")
            : "(none — answer directly without tools)") +
          ".\nCalls to any other tool will be rejected.",
      );
    }

    const known = (skills || []).filter(function (name) {
      return window.ChatreSkills && window.ChatreSkills.getSkill(name);
    });
    if (known.length) {
      parts.push("# Skill playbooks (apply only if they fit the brief above)");
      known.forEach(function (name) {
        const skill = window.ChatreSkills.getSkill(name);
        parts.push(
          window.ChatreSkills.formatSkill
            ? window.ChatreSkills.formatSkill(skill)
            : name,
        );
      });
    }

    if (
      window.ChatreSkills &&
      window.ChatreSkills.designTemplateBlock &&
      userText
    ) {
      const extra = window.ChatreSkills.designTemplateBlock(userText);
      if (extra) parts.push(extra.trim());
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
