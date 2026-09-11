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
    const b = briefing || {};
    const wrap = document.createElement("div");
    wrap.className = "plan-card";
    const templates =
      (window.ChatrePlanTemplates &&
        window.ChatrePlanTemplates.listTemplates &&
        window.ChatrePlanTemplates.listTemplates()) ||
      [];
    const tplOptions = templates
      .map(function (t) {
        return (
          '<option value="' +
          escapeHtml(t.id) +
          '">' +
          escapeHtml(t.label) +
          "</option>"
        );
      })
      .join("");
    wrap.innerHTML =
      "<strong>Plan</strong>" +
      (tplOptions
        ? '<label class="plan-label">Template</label><select class="plan-template"><option value="">(current)</option>' +
          tplOptions +
          "</select>"
        : "") +
      '<div class="plan-meta">' +
      escapeHtml(b.task_type || "mixed") +
      (b.goal ? " — " + escapeHtml(String(b.goal).slice(0, 120)) : "") +
      "</div>" +
      '<label class="plan-label">Understanding</label>' +
      '<textarea class="plan-understanding" rows="2"></textarea>' +
      '<label class="plan-label">Executor brief</label>' +
      '<textarea class="plan-brief" rows="4"></textarea>' +
      '<label class="plan-label">Checklist</label>' +
      '<ul class="plan-checklist"></ul>' +
      '<button type="button" class="btn plan-check-add">Add step</button>' +
      '<label class="plan-label">Success criteria (one per line)</label>' +
      '<textarea class="plan-criteria" rows="2"></textarea>' +
      '<div class="plan-actions">' +
      '<button type="button" class="btn plan-continue">Continue</button>' +
      '<button type="button" class="btn plan-cancel">Cancel</button>' +
      "</div>";

    function fill(next) {
      wrap.querySelector(".plan-understanding").value = next.understanding || "";
      wrap.querySelector(".plan-brief").value = next.executor_brief || "";
      wrap.querySelector(".plan-criteria").value = (
        next.success_criteria || []
      ).join("\n");
      const meta = wrap.querySelector(".plan-meta");
      if (meta) {
        meta.textContent =
          (next.task_type || "mixed") +
          (next.goal ? " — " + String(next.goal).slice(0, 120) : "");
      }
    }
    fill(b);

    const list = wrap.querySelector(".plan-checklist");
    function stepsFromBriefing(src) {
      const raw = [];
      if (Array.isArray(src.plan_steps) && src.plan_steps.length) {
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
      if (!raw.length) raw.push("Execute the plan");
      return raw;
    }
    function addCheckItem(text, done) {
      const li = document.createElement("li");
      li.className = "plan-check-item" + (done ? " done" : "");
      li.innerHTML =
        '<input type="checkbox" ' +
        (done ? "checked " : "") +
        '/>' +
        '<textarea rows="1"></textarea>';
      li.querySelector("textarea").value = text || "";
      const box = li.querySelector('input[type="checkbox"]');
      box.addEventListener("change", function () {
        li.classList.toggle("done", box.checked);
      });
      list.appendChild(li);
    }
    stepsFromBriefing(b).forEach(function (s) {
      addCheckItem(s, false);
    });
    wrap.querySelector(".plan-check-add").addEventListener("click", function () {
      addCheckItem("", false);
    });
    wrap.__collectSteps = function () {
      return Array.from(list.querySelectorAll(".plan-check-item")).map(function (li) {
        return {
          text: li.querySelector("textarea").value.trim(),
          done: li.querySelector('input[type="checkbox"]').checked,
        };
      }).filter(function (s) { return s.text; });
    };

    // Progress ticks from agent tool events
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
        }
      });
    }

    wrap.querySelector(".plan-continue").addEventListener("click", function () {
      const steps = wrap.__collectSteps ? wrap.__collectSteps() : [];
      const next = Object.assign({}, b, {
        understanding: wrap.querySelector(".plan-understanding").value,
        executor_brief: wrap.querySelector(".plan-brief").value,
        plan_steps: steps,
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
        "<p>" +
        escapeHtml(question) +
        "</p>" +
        '<div class="plan-actions">' +
        '<button type="button" class="btn confirm-yes">' +
        escapeHtml(action || "Approve") +
        "</button>" +
        '<button type="button" class="btn confirm-no">Deny</button>' +
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
    return String(text || "").replace(
      /<confirmation\b[^>]*\/?>/gi,
      "",
    );
  }

  window.ChatrePlanUI = {
    renderPlanCard: renderPlanCard,
    renderConfirmations: renderConfirmations,
    stripConfirmationTags: stripConfirmationTags,
  };
})();
