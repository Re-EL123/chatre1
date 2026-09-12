/**
 * Chatre analyst — understands the request and writes a brief for the executor.
 */
(function () {
  "use strict";

  const ANALYST_SYSTEM_PROMPT =
    "You are Chatre's analysis agent. You do NOT execute tools. Your only job is to understand THIS specific user request and write a precise brief that another Chatre executor agent will follow.\n\n" +
    "Rules:\n" +
    "- You are Chatre. Never mention other products or agents.\n" +
    "- No flattery. Be direct.\n" +
    "- Do not give the final user-facing answer. Produce an execution brief only.\n" +
    "- Tailor everything to THIS request. Do not use a generic template that would fit any task.\n" +
    '- If the request is a simple greeting or pure chat with no work, set task_type to "chat" and keep the brief minimal.\n' +
    "- If key details are missing and you cannot infer them, set needs_clarification to true and ask ONE short question in clarification_question.\n\n" +
    "Output ONLY a single JSON object (no markdown fences, no prose outside JSON) with this shape:\n" +
    "{\n" +
    '  "understanding": "1-3 sentences",\n' +
    '  "goal": "one-line goal",\n' +
    '  "task_type": "chat|question|research|browser|build|debug|document|git|run|mixed",\n' +
    '  "success_criteria": ["..."],\n' +
    '  "approach": ["..."],\n' +
    '  "todos": [{"id":"t1","content":"..."}],\n' +
    '  "tools_priority": ["..."],\n' +
    '  "do_not": ["..."],\n' +
    '  "constraints": ["..."],\n' +
    '  "needs_clarification": false,\n' +
    '  "clarification_question": "",\n' +
    '  "max_steps": 8,\n' +
    '  "estimated_minutes": 2,\n' +
    '  "executor_brief": "Detailed instructions for the executor, specific to this request"\n' +
    "}\n\n" +
    "Set max_steps realistically (prefer 4–12). Prefer fewer high-value tools over long loops.";

  function extractJsonObject(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      /* continue */
    }
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) {
      try {
        return JSON.parse(fence[1].trim());
      } catch (e2) {
        /* continue */
      }
    }
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch (e3) {
        return null;
      }
    }
    return null;
  }

  function normalizeBriefing(obj, userMessage) {
    const o = obj && typeof obj === "object" ? obj : {};
    const todos = Array.isArray(o.todos)
      ? o.todos
          .map(function (t, i) {
            if (typeof t === "string") {
              return { id: "t" + (i + 1), content: t, status: "pending" };
            }
            if (!t || typeof t !== "object") return null;
            return {
              id: String(t.id || "t" + (i + 1)),
              content: String(t.content || t.text || ""),
              status: "pending",
            };
          })
          .filter(function (t) {
            return t && t.content;
          })
      : [];

    const taskTypeRaw = String(o.task_type || o.taskType || "mixed").toLowerCase();
    const msg = String(userMessage || "").toLowerCase();
    // Hard overrides — don't let code-mode prefixes or weak LLM classification
    // turn a PDF/book request into research/build theatre.
    let taskType = taskTypeRaw;
    if (
      /\bpdf\b/.test(msg) ||
      /\b(generate|create|make|write)\b.{0,40}\b(book|report|guide|manual|essay)\b/.test(
        msg,
      )
    ) {
      taskType = "document";
    } else if (/^\s*(hi|hello|hey|thanks|thank you)\b/.test(msg) && msg.length < 40) {
      taskType = "chat";
    }

    let toolsPriority = Array.isArray(o.tools_priority)
      ? o.tools_priority.map(String)
      : Array.isArray(o.toolsPriority)
        ? o.toolsPriority.map(String)
        : [];
    if (taskType === "document") {
      if (/\bpdf\b/.test(msg)) {
        toolsPriority = ["create_pdf", "create_document"].concat(
          toolsPriority.filter(function (t) {
            return t !== "create_pdf" && t !== "create_document";
          }),
        );
      } else if (!toolsPriority.length) {
        toolsPriority = ["create_document", "create_pdf"];
      }
    }

    const doNot = Array.isArray(o.do_not)
      ? o.do_not.map(String)
      : Array.isArray(o.doNot)
        ? o.doNot.map(String)
        : [];
    if (taskType === "document") {
      [
        "Do not invent download URLs",
        "Do not dump Python/fpdf or /mnt/data paths",
        "Do not claim a file exists without a successful create_pdf/create_document tool result",
      ].forEach(function (rule) {
        if (doNot.indexOf(rule) < 0) doNot.push(rule);
      });
    }

    return {
      understanding: String(o.understanding || "").trim(),
      goal:
        String(o.goal || "").trim() ||
        String(userMessage || "").slice(0, 200),
      task_type: taskType,
      success_criteria: Array.isArray(o.success_criteria)
        ? o.success_criteria.map(String)
        : [],
      approach: Array.isArray(o.approach) ? o.approach.map(String) : [],
      todos: todos,
      tools_priority: toolsPriority,
      do_not: doNot,
      constraints: Array.isArray(o.constraints) ? o.constraints.map(String) : [],
      needs_clarification: o.needs_clarification === true,
      clarification_question: String(
        o.clarification_question || o.clarificationQuestion || "",
      ).trim(),
      max_steps: (function () {
        const n = Number(o.max_steps || o.maxSteps || o.budget_steps) || 0;
        return n > 0 ? Math.min(Math.max(n, 1), 40) : undefined;
      })(),
      estimated_minutes: (function () {
        const n = Number(o.estimated_minutes || o.estimatedMinutes) || 0;
        return n > 0 ? n : undefined;
      })(),
      executor_brief: String(o.executor_brief || o.executorBrief || "").trim(),
    };
  }

  function formatExecutorPrompt(briefing, userMessage) {
    const b = briefing || {};
    const lines = [
      "# Executor orders (from Chatre analysis — follow these, not a generic script)",
      "",
      "## User request",
      String(userMessage || "").trim(),
      "",
      "## Understanding",
      b.understanding || "(see user request)",
      "",
      "## Goal",
      b.goal || "(complete the user request)",
      "",
      "## Task type",
      b.task_type || "mixed",
    ];
    if (b.success_criteria && b.success_criteria.length) {
      lines.push("", "## Success criteria (must meet before finishing)");
      b.success_criteria.forEach(function (c, i) {
        lines.push(i + 1 + ". " + c);
      });
    }
    if (b.approach && b.approach.length) {
      lines.push("", "## Approach for THIS task");
      b.approach.forEach(function (c, i) {
        lines.push(i + 1 + ". " + c);
      });
    }
    if (b.tools_priority && b.tools_priority.length) {
      lines.push(
        "",
        "## Preferred tools (in order)",
        b.tools_priority.join(", "),
      );
    }
    if (b.do_not && b.do_not.length) {
      lines.push("", "## Do not");
      b.do_not.forEach(function (c) {
        lines.push("- " + c);
      });
    }
    if (b.constraints && b.constraints.length) {
      lines.push("", "## Constraints");
      b.constraints.forEach(function (c) {
        lines.push("- " + c);
      });
    }
    if (b.executor_brief) {
      lines.push("", "## Detailed brief", b.executor_brief);
    }
    lines.push(
      "",
      "## Rules for you (executor)",
      "- Execute this brief thoroughly. Adapt tool use to THESE orders — do not run a generic loop if it does not fit.",
      "- Track todos; mark each done when finished.",
      "- Verify against success criteria before you stop.",
      "- Do not narrate process. Act, then give a short useful final answer.",
    );
    return lines.join("\n");
  }

  function analystUserPrompt(userMessage, historySnippet) {
    let prompt =
      "Analyze this user request and produce the JSON briefing.\n\nUser request:\n" +
      String(userMessage || "").trim();
    if (historySnippet) {
      prompt +=
        "\n\nRecent conversation context (may help):\n" +
        String(historySnippet).slice(0, 3000);
    }
    return prompt;
  }

  function historySnippet(messages) {
    if (!Array.isArray(messages) || !messages.length) return "";
    return messages
      .slice(-6)
      .map(function (m) {
        return (
          (m && m.role ? m.role : "user") +
          ": " +
          String((m && m.content) || "").slice(0, 400)
        );
      })
      .join("\n");
  }

  /**
   * Call the Worker in analyst mode (no tools) and return a normalized briefing.
   */
  async function runAnalysis(userMessage, options) {
    const opts = options || {};
    const signal = opts.signal;
    const model =
      opts.model || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
    const history = opts.history || [];
    const snippet = historySnippet(history);

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: signal,
      body: JSON.stringify({
        model: model,
        stream: false,
        agent: false,
        mode: "analyst",
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: analystUserPrompt(userMessage, snippet),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error("Analyst HTTP " + response.status);
    }
    const data = await response.json();
    const text = (data && (data.response || data.text)) || "";
    const parsed = extractJsonObject(text);
    return normalizeBriefing(parsed, userMessage);
  }

  window.ChatreAnalyst = {
    ANALYST_SYSTEM_PROMPT: ANALYST_SYSTEM_PROMPT,
    extractJsonObject: extractJsonObject,
    normalizeBriefing: normalizeBriefing,
    formatExecutorPrompt: formatExecutorPrompt,
    analystUserPrompt: analystUserPrompt,
    historySnippet: historySnippet,
    runAnalysis: runAnalysis,
  };
})();
