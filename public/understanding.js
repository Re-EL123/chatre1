/**
 * Message-understanding precision (client mirror of chatre-api/lib/understanding.js).
 */
(function () {
  "use strict";

  var CONFIDENCE_THRESHOLD = 0.75;

  var SOFT_DONE_PATTERNS = [
    /^user-visible goal completed/i,
    /^goal completed with workspace/i,
    /^deliverables exist and match/i,
    /^verify and summarize$/i,
    /^implement the work$/i,
    /^complete the (user )?request$/i,
    /^done$/i,
    /^finished$/i,
    /^success$/i,
    /^as requested$/i,
    /^task complete/i,
  ];

  function clamp01(n, fallback) {
    var x = Number(n);
    if (!isFinite(x)) return fallback;
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  }

  function asStringList(v) {
    if (!Array.isArray(v)) return [];
    return v
      .map(function (x) {
        if (typeof x === "string") return x.trim();
        if (x && typeof x === "object") {
          return String(x.text || x.content || x.message || "").trim();
        }
        return "";
      })
      .filter(Boolean)
      .slice(0, 12);
  }

  function isSoftDoneWhen(s) {
    var t = String(s || "").trim();
    if (!t || t.length < 8) return true;
    return SOFT_DONE_PATTERNS.some(function (re) {
      return re.test(t);
    });
  }

  function classifyDeliverableKind(userMessage, taskType) {
    var msg = String(userMessage || "").trim();
    var lower = msg.toLowerCase();
    var t = String(taskType || "").toLowerCase();
    var howToLead =
      /^(how\s+(do|to|can|should)|what\s+(is|are|does)|why\s+(is|does|do)|explain|describe|tell\s+me|can\s+you\s+explain)\b/i.test(
        msg,
      ) ||
      /\b(how\s+(do|to|can)\s+i|what\s+does\s+.{0,40}\s+mean)\b/i.test(lower);
    var deliverVerb =
      /\b(build|create|make|implement|scaffold|generate|write|fix|patch|deploy|commit|push|clone|run|execute)\b/i.test(
        msg,
      );
    var wantsArtifact =
      /\b(pdf|spreadsheet|xlsx|csv|pptx|docx|html|app|website|landing\s*page|game|repo|pull\s*request)\b/i.test(
        lower,
      );
    if (t === "chat") return "answer";
    if (
      howToLead &&
      !wantsArtifact &&
      !/\b(for\s+me|into\s+(my|the)\s+workspace)\b/i.test(lower)
    ) {
      return "answer";
    }
    if (t === "question" && !deliverVerb && !wantsArtifact) return "answer";
    if (
      t === "build" ||
      t === "document" ||
      t === "git" ||
      t === "run" ||
      t === "debug"
    ) {
      return "deliver";
    }
    if (deliverVerb || wantsArtifact) return "deliver";
    return "mixed";
  }

  function suggestMode(briefing, composerMode) {
    var b = briefing || {};
    var current = String(composerMode || "agent").toLowerCase() || "agent";
    var t = String(b.task_type || "mixed").toLowerCase();
    var kind = String(b.deliverable_kind || "mixed").toLowerCase();
    var suggested = "agent";
    var reason = "General agent loop for this task type.";
    if (t === "chat" || (kind === "answer" && (t === "question" || t === "chat"))) {
      suggested = "chat";
      reason =
        "Looks like a conversational / explain-only request — Chat avoids unnecessary tools.";
    } else if (t === "browser") {
      suggested = "browse";
      reason = "Browser interaction is central — Browse mode prioritizes navigation tools.";
    } else if (t === "research" && kind !== "deliver") {
      suggested = "explore";
      reason =
        "Research/explore fits read-heavy investigation without mutating the product.";
    } else if (
      kind === "deliver" &&
      (t === "build" || t === "document" || t === "debug")
    ) {
      suggested = "agent";
      reason = "Workspace delivery (files/preview) fits Agent mode.";
    } else if (t === "question" && kind === "answer") {
      suggested = "chat";
      reason =
        "Question can be answered directly; switch to Agent only if you want tools.";
    }
    return {
      suggested_mode: suggested,
      mode_reason: reason,
      mode_matches: suggested === current,
      current_mode: current,
    };
  }

  function formatIntentContract(briefing) {
    var b = briefing || {};
    var lines = [
      "You want: " + (b.goal || b.understanding || "(unclear)"),
      "I will: " +
        (b.deliverable_kind === "answer"
          ? "answer / explain (no workspace files unless you ask)"
          : b.deliverable_kind === "deliver"
            ? "deliver workspace artifacts"
            : "mix of answer and tools as needed"),
      "Done when: " +
        (isSoftDoneWhen(b.done_when) ? "(needs a concrete check)" : b.done_when),
    ];
    var assumptions = asStringList(b.assumptions);
    if (assumptions.length) {
      lines.push("I assumed: " + assumptions.slice(0, 4).join("; "));
    }
    var unknowns = asStringList(b.unknowns);
    if (unknowns.length) {
      lines.push("Still unclear: " + unknowns.slice(0, 4).join("; "));
    }
    if (b.confidence != null) {
      lines.push("Confidence: " + Math.round(Number(b.confidence) * 100) + "%");
    }
    return lines.join("\n");
  }

  function detectCorrectionMessage(text) {
    var t = String(text || "").trim();
    if (!t) return null;
    if (
      /^(no[,.]?\s+|nope[,.]?\s+|not\s+what\s+i\s+meant|i\s+meant\b|actually\b|correction\b|rather\b|instead\b)/i.test(
        t,
      ) ||
      /\b(i\s+meant|not\s+that|wrong\s+—|wrong\s+-)\b/i.test(t)
    ) {
      return t.slice(0, 500);
    }
    return null;
  }

  function correctionsKey(threadId) {
    return "chatre_corrections_" + String(threadId || "local");
  }

  function loadCorrections(threadId) {
    try {
      var raw = sessionStorage.getItem(correctionsKey(threadId));
      var list = raw ? JSON.parse(raw) : [];
      return asStringList(list);
    } catch (e) {
      return [];
    }
  }

  function saveCorrection(threadId, text) {
    var msg = String(text || "").trim();
    if (!msg) return loadCorrections(threadId);
    var list = loadCorrections(threadId);
    if (list.indexOf(msg) < 0) list.unshift(msg);
    list = list.slice(0, 16);
    try {
      sessionStorage.setItem(correctionsKey(threadId), JSON.stringify(list));
    } catch (e) {
      /* ignore */
    }
    return list;
  }

  function rememberIfCorrection(text, threadId) {
    var detected = detectCorrectionMessage(text);
    if (!detected) return loadCorrections(threadId);
    return saveCorrection(threadId, detected);
  }

  function mergeCorrections(briefing, corrections) {
    var b = briefing && typeof briefing === "object" ? Object.assign({}, briefing) : {};
    var incoming = asStringList(corrections);
    var prev = asStringList(b.user_corrections);
    var merged = [];
    incoming.concat(prev).forEach(function (c) {
      if (merged.indexOf(c) < 0) merged.push(c);
    });
    b.user_corrections = merged.slice(0, 16);
    if (merged.length) {
      b.constraints = asStringList(b.constraints)
        .concat(
          merged.map(function (c) {
            return "User correction: " + c;
          }),
        )
        .filter(function (x, i, arr) {
          return arr.indexOf(x) === i;
        })
        .slice(0, 20);
    }
    return b;
  }

  function isHowToQuestion(text) {
    return classifyDeliverableKind(text, "question") === "answer";
  }

  window.ChatreUnderstanding = {
    CONFIDENCE_THRESHOLD: CONFIDENCE_THRESHOLD,
    isSoftDoneWhen: isSoftDoneWhen,
    classifyDeliverableKind: classifyDeliverableKind,
    suggestMode: suggestMode,
    formatIntentContract: formatIntentContract,
    detectCorrectionMessage: detectCorrectionMessage,
    loadCorrections: loadCorrections,
    saveCorrection: saveCorrection,
    rememberIfCorrection: rememberIfCorrection,
    mergeCorrections: mergeCorrections,
    asStringList: asStringList,
    clamp01: clamp01,
    isHowToQuestion: isHowToQuestion,
  };
})();
