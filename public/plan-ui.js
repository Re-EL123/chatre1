/**
 * Plan approval card + confirmation chips for Chatre agent UX.
 */
(function () {
  "use strict";

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * Render editable plan from analyst briefing. Calls onContinue(briefing).
   */
  function renderPlanCard(briefing, onContinue, onCancel) {
    const b = Object.assign({}, briefing || {});
    // Prefer approach/todos for checklist (analyst + templates use those).
    function stepsFromBriefing(src) {
      const raw = [];
      if (Array.isArray(src.approach) && src.approach.length) {
        src.approach.forEach(function (s) {
          raw.push(typeof s === "string" ? s : s.text || s.content || "");
        });
      } else if (Array.isArray(src.todos) && src.todos.length) {
        src.todos.forEach(function (t) {
          raw.push(
            typeof t === "string" ? t : (t && (t.content || t.text)) || "",
          );
        });
      } else if (Array.isArray(src.plan_steps) && src.plan_steps.length) {
        src.plan_steps.forEach(function (s) {
          raw.push(typeof s === "string" ? s : s.text || s.content || "");
        });
      } else if (src.executor_brief) {
        String(src.executor_brief)
          .split(/\n+/)
          .map(function (l) {
            return l.replace(/^[-*\d.)\s]+/, "").trim();
          })
          .filter(Boolean)
          .slice(0, 12)
          .forEach(function (l) {
            raw.push(l);
          });
      }
      return raw.filter(Boolean);
    }

    function isSparse(src) {
      const hasText = !!(
        String(src.understanding || "").trim() ||
        String(src.executor_brief || "").trim()
      );
      return !hasText || !stepsFromBriefing(src).length;
    }

    // Auto-seed from matching template when analyst left the plan blank.
    if (
      isSparse(b) &&
      window.ChatrePlanTemplates &&
      window.ChatrePlanTemplates.briefingFromTemplate
    ) {
      const type = String(b.task_type || "").toLowerCase();
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
      const tid = b.template_id || map[type] || "";
      if (tid) {
        const seeded = window.ChatrePlanTemplates.briefingFromTemplate(
          tid,
          b.goal || "",
        );
        if (seeded) {
          Object.assign(b, {
            understanding: b.understanding || seeded.understanding,
            goal: b.goal || seeded.goal,
            task_type: b.task_type || seeded.task_type,
            success_criteria:
              b.success_criteria && b.success_criteria.length
                ? b.success_criteria
                : seeded.success_criteria,
            approach:
              b.approach && b.approach.length ? b.approach : seeded.approach,
            todos: b.todos && b.todos.length ? b.todos : seeded.todos,
            tools_priority:
              b.tools_priority && b.tools_priority.length
                ? b.tools_priority
                : seeded.tools_priority,
            executor_brief: b.executor_brief || seeded.executor_brief,
            max_steps: b.max_steps || seeded.max_steps,
            template_id: tid,
          });
        }
      }
      if (!String(b.understanding || "").trim()) {
        b.understanding = "Execute the user request directly.";
      }
      if (!String(b.executor_brief || "").trim()) {
        b.executor_brief =
          "Complete the user request thoroughly. Match tools to the request.";
      }
      if (!stepsFromBriefing(b).length) {
        b.approach = [
          "Inspect what is needed",
          "Do the work with tools",
          "Verify and summarize",
        ];
      }
    }

    const wrap = document.createElement("div");
    wrap.className = "plan-card";
    const templates =
      (window.ChatrePlanTemplates &&
        window.ChatrePlanTemplates.listTemplates &&
        window.ChatrePlanTemplates.listTemplates()) ||
      [];
    const tplOptions = templates
      .map(function (t) {
        const selected =
          b.template_id && b.template_id === t.id ? " selected" : "";
        return (
          '<option value="' +
          escapeHtml(t.id) +
          '"' +
          selected +
          ">" +
          escapeHtml(t.label) +
          "</option>"
        );
      })
      .join("");

    wrap.innerHTML =
      '<header class="plan-card-head">' +
      '<div class="plan-card-title">Review plan</div>' +
      '<p class="plan-meta"></p>' +
      "</header>" +
      (tplOptions
        ? '<div class="plan-field">' +
          '<label class="plan-label">Template</label>' +
          '<select class="plan-template">' +
          '<option value="">Keep current</option>' +
          tplOptions +
          "</select></div>"
        : "") +
      '<div class="plan-field">' +
      '<label class="plan-label">Understanding</label>' +
      '<textarea class="plan-understanding" rows="2" placeholder="What the agent understood…"></textarea>' +
      "</div>" +
      '<div class="plan-field">' +
      '<label class="plan-label">Executor brief</label>' +
      '<textarea class="plan-brief" rows="4" placeholder="How it will execute…"></textarea>' +
      "</div>" +
      '<div class="plan-field">' +
      '<div class="plan-label-row">' +
      '<label class="plan-label">Checklist</label>' +
      '<button type="button" class="btn plan-check-add">Add step</button>' +
      "</div>" +
      '<ul class="plan-checklist"></ul>' +
      "</div>" +
      '<div class="plan-field">' +
      '<label class="plan-label">Success criteria</label>' +
      '<textarea class="plan-criteria" rows="2" placeholder="One criterion per line"></textarea>' +
      "</div>" +
      '<div class="plan-actions">' +
      '<button type="button" class="btn plan-cancel">Cancel</button>' +
      '<button type="button" class="btn plan-continue">Approve & continue</button>' +
      "</div>";

    function fill(next) {
      wrap.querySelector(".plan-understanding").value = next.understanding || "";
      wrap.querySelector(".plan-brief").value = next.executor_brief || "";
      wrap.querySelector(".plan-criteria").value = (
        next.success_criteria || []
      ).join("\n");
      const meta = wrap.querySelector(".plan-meta");
      if (meta) {
        const type = next.task_type || "mixed";
        const goal = next.goal ? String(next.goal).slice(0, 140) : "";
        meta.innerHTML =
          '<span class="plan-type">' +
          escapeHtml(type) +
          "</span>" +
          (goal ? '<span class="plan-goal">' + escapeHtml(goal) + "</span>" : "");
      }
    }
    fill(b);

    const list = wrap.querySelector(".plan-checklist");
    function addCheckItem(text, done) {
      const li = document.createElement("li");
      li.className = "plan-check-item" + (done ? " done" : "");
      li.innerHTML =
        '<input type="checkbox" ' +
        (done ? "checked " : "") +
        "/>" +
        '<textarea rows="1" placeholder="Step…"></textarea>' +
        '<button type="button" class="plan-check-remove" aria-label="Remove step">×</button>';
      li.querySelector("textarea").value = text || "";
      const box = li.querySelector('input[type="checkbox"]');
      box.addEventListener("change", function () {
        li.classList.toggle("done", box.checked);
      });
      li.querySelector(".plan-check-remove").addEventListener("click", function () {
        li.remove();
      });
      list.appendChild(li);
      const ta = li.querySelector("textarea");
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
      ta.addEventListener("input", function () {
        ta.style.height = "auto";
        ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
      });
    }
    const initialSteps = stepsFromBriefing(b);
    (initialSteps.length ? initialSteps : ["Execute the plan"]).forEach(
      function (s) {
        addCheckItem(s, false);
      },
    );
    wrap.querySelector(".plan-check-add").addEventListener("click", function () {
      addCheckItem("", false);
    });
    wrap.__collectSteps = function () {
      return Array.from(list.querySelectorAll(".plan-check-item"))
        .map(function (li) {
          return {
            text: li.querySelector("textarea").value.trim(),
            done: li.querySelector('input[type="checkbox"]').checked,
          };
        })
        .filter(function (s) {
          return s.text;
        });
    };

    wrap.markStepProgress = function (hint) {
      const items = Array.from(list.querySelectorAll(".plan-check-item"));
      const open = items.find(function (li) {
        return !li.querySelector('input[type="checkbox"]').checked;
      });
      if (open) {
        open.querySelector('input[type="checkbox"]').checked = true;
        open.classList.add("done");
        if (hint) {
          const ta = open.querySelector("textarea");
          if (ta && !ta.value) ta.value = hint;
        }
      }
    };
    window.__activePlanChecklist = wrap;

    const sel = wrap.querySelector(".plan-template");
    if (sel) {
      if (b.template_id) sel.value = b.template_id;
      sel.addEventListener("change", function () {
        const id = sel.value;
        if (!id || !window.ChatrePlanTemplates) return;
        const seeded = window.ChatrePlanTemplates.briefingFromTemplate(
          id,
          b.goal || "",
        );
        if (seeded) {
          Object.assign(b, seeded);
          fill(seeded);
          list.innerHTML = "";
          stepsFromBriefing(seeded).forEach(function (s) {
            addCheckItem(s, false);
          });
        }
      });
    }

    wrap.querySelector(".plan-continue").addEventListener("click", function () {
      const steps = wrap.__collectSteps ? wrap.__collectSteps() : [];
      const next = Object.assign({}, b, {
        understanding: wrap.querySelector(".plan-understanding").value,
        executor_brief: wrap.querySelector(".plan-brief").value,
        plan_steps: steps,
        approach: steps.map(function (s) {
          return s.text;
        }),
        todos: steps.map(function (s, i) {
          return {
            id: "t" + (i + 1),
            content: s.text,
            status: s.done ? "done" : "pending",
          };
        }),
        success_criteria: wrap
          .querySelector(".plan-criteria")
          .value.split("\n")
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean),
      });
      if (steps.length) {
        next.executor_brief =
          (next.executor_brief ? next.executor_brief + "\n\n" : "") +
          "Checklist:\n" +
          steps
            .map(function (s, i) {
              return (s.done ? "[x] " : "[ ] ") + (i + 1) + ". " + s.text;
            })
            .join("\n");
      }
      if (typeof onContinue === "function") onContinue(next);
    });
    wrap.querySelector(".plan-cancel").addEventListener("click", function () {
      if (typeof onCancel === "function") onCancel();
      wrap.remove();
    });
    return wrap;
  }

  /**
   * Parse <confirmation question="..." action="..." /> and render Approve/Deny.
   */
  function renderConfirmations(text, onApprove, onDeny) {
    const re =
      /<confirmation\s+question="([^"]*)"\s+action="([^"]*)"\s*\/>/gi;
    const nodes = [];
    let m;
    const src = String(text || "");
    while ((m = re.exec(src))) {
      const question = m[1];
      const action = m[2];
      const row = document.createElement("div");
      row.className = "confirm-card";
      row.innerHTML =
        '<p class="confirm-q">' +
        escapeHtml(question) +
        "</p>" +
        '<div class="plan-actions">' +
        '<button type="button" class="btn confirm-no">Deny</button>' +
        '<button type="button" class="btn confirm-yes">' +
        escapeHtml(action || "Approve") +
        "</button>" +
        "</div>";
      row.querySelector(".confirm-yes").addEventListener("click", function () {
        if (typeof onApprove === "function") onApprove(action, question);
        row.remove();
      });
      row.querySelector(".confirm-no").addEventListener("click", function () {
        if (typeof onDeny === "function") onDeny(action, question);
        row.remove();
      });
      nodes.push(row);
    }
    return nodes;
  }

  function stripConfirmationTags(text) {
    return String(text || "").replace(/<confirmation\b[^>]*\/?>/gi, "");
  }

  window.ChatrePlanUI = {
    renderPlanCard: renderPlanCard,
    renderConfirmations: renderConfirmations,
    stripConfirmationTags: stripConfirmationTags,
  };
})();
