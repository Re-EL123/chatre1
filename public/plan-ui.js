/**
 * Plan approval card + confirmation chips for Chatre agent UX.
 * PLAN.md is the source of truth shown alongside the editable briefing.
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

  function filesFromBriefing(src) {
    if (Array.isArray(src.files) && src.files.length) {
      return src.files
        .map(function (f) {
          return typeof f === "string" ? f : (f && (f.path || f.name)) || "";
        })
        .filter(Boolean);
    }
    if (Array.isArray(src.file_list)) return src.file_list.filter(Boolean);
    return [];
  }

  function validatePlanBriefing(next) {
    const errors = [];
    const goal = String(next.goal || "").trim();
    const done = String(next.done_when || next.doneWhen || "").trim();
    const steps = stepsFromBriefing(next);
    const files = filesFromBriefing(next);
    const acceptance = Array.isArray(next.success_criteria)
      ? next.success_criteria.filter(Boolean)
      : [];
    if (goal.length < 4) errors.push("Goal must be a concrete sentence");
    if (
      done.length < 4 ||
      (window.ChatreUnderstanding &&
        window.ChatreUnderstanding.isSoftDoneWhen(done))
    ) {
      errors.push("Done when must be observable");
    }
    if (steps.length < 2) errors.push("Checklist needs at least 2 steps");
    if (
      files.length < 1 &&
      next.deliverable_kind !== "answer" &&
      next.task_type !== "chat" &&
      next.task_type !== "question"
    ) {
      errors.push("List at least one file path to create or edit");
    }
    if (acceptance.length < 1) {
      errors.push("Success criteria need at least one measurable check");
    }
    return errors;
  }

  /**
   * Render editable plan from analyst briefing. Calls onContinue(briefing).
   * opts: { planMarkdown, planPath, planErrors, planComplete }
   */
  function renderPlanCard(briefing, onContinue, onCancel, opts) {
    const b = Object.assign({}, briefing || {});
    const o = opts || {};
    if (b.planMarkdown && !o.planMarkdown) o.planMarkdown = b.planMarkdown;
    if (b.planPath && !o.planPath) o.planPath = b.planPath;
    if (b.planErrors && !o.planErrors) o.planErrors = b.planErrors;

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
            files:
              b.files && b.files.length
                ? b.files
                : seeded.files || seeded.file_list || [],
            done_when: b.done_when || seeded.done_when || "",
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
      if (!filesFromBriefing(b).length && String(b.task_type || "") === "build") {
        b.files = ["/home/user/projects/" + (b.project_slug || "app") + "/"];
      }
      if (!String(b.done_when || "").trim() && b.success_criteria && b.success_criteria[0]) {
        b.done_when = b.success_criteria[0];
      }
      if (!(b.success_criteria && b.success_criteria.length)) {
        b.success_criteria = b.goal
          ? ["Observable result matches: " + String(b.goal).slice(0, 160)]
          : [];
      }
    }

    const wrap = document.createElement("div");
    wrap.className = "plan-card plan-card-thin";
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

    const errList = Array.isArray(o.planErrors) ? o.planErrors : [];
    const errHtml = errList.length
      ? '<div class="plan-errors" role="alert"><strong>Plan incomplete:</strong><ul>' +
        errList
          .map(function (e) {
            return "<li>" + escapeHtml(e) + "</li>";
          })
          .join("") +
        "</ul></div>"
      : "";

    wrap.innerHTML =
      '<header class="plan-card-head">' +
      '<div class="plan-card-title">Approve plan</div>' +
      '<p class="plan-meta"></p>' +
      "</header>" +
      errHtml +
      (o.planPath
        ? '<p class="plan-path">PLAN.md · <code>' +
          escapeHtml(o.planPath) +
          "</code></p>"
        : "") +
      '<div class="plan-core-fields">' +
      '<div class="plan-field plan-intent-contract">' +
      '<label class="plan-label">Intent</label>' +
      '<pre class="plan-contract-view"></pre>' +
      "</div>" +
      '<div class="plan-field">' +
      '<label class="plan-label">Goal</label>' +
      '<textarea class="plan-goal-input" rows="2" placeholder="Concrete goal…"></textarea>' +
      "</div>" +
      '<div class="plan-field">' +
      '<label class="plan-label">Done when</label>' +
      '<textarea class="plan-done-input" rows="2" placeholder="Observable completion…"></textarea>' +
      "</div>" +
      '<div class="plan-field">' +
      '<label class="plan-label">Files (one path per line)</label>' +
      '<textarea class="plan-files" rows="2" placeholder="/home/user/projects/app/index.html"></textarea>' +
      "</div>" +
      "</div>" +
      '<details class="plan-details-more">' +
      "<summary>More details</summary>" +
      (o.planMarkdown
        ? '<details class="plan-md-details">' +
          "<summary>PLAN.md preview</summary>" +
          '<pre class="plan-md-preview"></pre></details>'
        : "") +
      (tplOptions
        ? '<div class="plan-field">' +
          '<label class="plan-label">Template</label>' +
          '<select class="plan-template">' +
          '<option value="">Keep current</option>' +
          tplOptions +
          "</select></div>"
        : "") +
      '<div class="plan-field plan-assumptions-row">' +
      '<label class="plan-label">Assumptions (one per line)</label>' +
      '<textarea class="plan-assumptions" rows="2" placeholder="What was inferred…"></textarea>' +
      "</div>" +
      '<div class="plan-field">' +
      '<label class="plan-label">Still unclear / corrections</label>' +
      '<textarea class="plan-unknowns" rows="2" placeholder="Anything still wrong or missing…"></textarea>' +
      "</div>" +
      '<div class="plan-field">' +
      '<label class="plan-label">Understanding</label>' +
      '<textarea class="plan-understanding" rows="2" placeholder="What the agent understood…"></textarea>' +
      "</div>" +
      '<div class="plan-mode-suggest" hidden></div>' +
      '<div class="plan-field">' +
      '<label class="plan-label">Executor brief</label>' +
      '<textarea class="plan-brief" rows="3" placeholder="How it will execute…"></textarea>' +
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
      "</details>" +
      '<p class="plan-validate-msg" hidden></p>' +
      '<div class="plan-actions">' +
      '<button type="button" class="btn plan-cancel">Cancel</button>' +
      '<button type="button" class="btn plan-continue">Approve & continue</button>' +
      "</div>";

    function fieldValue(sel) {
      const el = wrap.querySelector(sel);
      if (!el) return "";
      return String(el.value != null ? el.value : "").trim();
    }

    function fill(next) {
      const goalInput = wrap.querySelector(".plan-goal-input");
      const doneInput = wrap.querySelector(".plan-done-input");
      if (goalInput) goalInput.value = next.goal || "";
      if (doneInput) doneInput.value = next.done_when || next.doneWhen || "";
      wrap.querySelector(".plan-understanding").value = next.understanding || "";
      wrap.querySelector(".plan-brief").value = next.executor_brief || "";
      wrap.querySelector(".plan-files").value = filesFromBriefing(next).join("\n");
      wrap.querySelector(".plan-criteria").value = (
        next.success_criteria || []
      ).join("\n");
      const assumptionsEl = wrap.querySelector(".plan-assumptions");
      if (assumptionsEl) {
        assumptionsEl.value = (next.assumptions || []).join("\n");
      }
      const unknownsEl = wrap.querySelector(".plan-unknowns");
      if (unknownsEl) {
        unknownsEl.value = (next.unknowns || next.user_corrections || []).join(
          "\n",
        );
      }
      const contractEl = wrap.querySelector(".plan-contract-view");
      if (contractEl) {
        const contract =
          next.intent_contract ||
          (window.ChatreUnderstanding &&
            window.ChatreUnderstanding.formatIntentContract(next)) ||
          "";
        contractEl.textContent = contract;
      }
      const modeBox = wrap.querySelector(".plan-mode-suggest");
      if (modeBox) {
        const suggestion =
          next.mode_suggestion ||
          (window.ChatreUnderstanding &&
            window.ChatreUnderstanding.suggestMode(
              next,
              window.ChatreComposer && window.ChatreComposer.getMode
                ? window.ChatreComposer.getMode()
                : "agent",
            ));
        if (
          suggestion &&
          suggestion.suggested_mode &&
          !suggestion.mode_matches
        ) {
          modeBox.hidden = false;
          modeBox.innerHTML =
            '<span class="plan-mode-text">Suggested mode: <strong>' +
            escapeHtml(suggestion.suggested_mode) +
            "</strong> — " +
            escapeHtml(suggestion.mode_reason || "") +
            '</span> <button type="button" class="btn plan-apply-mode">Use ' +
            escapeHtml(suggestion.suggested_mode) +
            "</button>";
          const applyBtn = modeBox.querySelector(".plan-apply-mode");
          if (applyBtn) {
            applyBtn.addEventListener("click", function () {
              if (window.ChatreComposer && window.ChatreComposer.setMode) {
                window.ChatreComposer.setMode(suggestion.suggested_mode);
              }
              modeBox.hidden = true;
            });
          }
        } else {
          modeBox.hidden = true;
          modeBox.innerHTML = "";
        }
      }
      const meta = wrap.querySelector(".plan-meta");
      if (meta) {
        const type = next.task_type || "mixed";
        const kind = next.deliverable_kind || "";
        const conf =
          next.confidence != null
            ? Math.round(Number(next.confidence) * 100) + "%"
            : "";
        const goal = next.goal ? String(next.goal).slice(0, 140) : "";
        meta.innerHTML =
          '<span class="plan-type">' +
          escapeHtml(type) +
          (kind ? " · " + escapeHtml(kind) : "") +
          (conf ? " · " + escapeHtml(conf) : "") +
          "</span>" +
          (goal
            ? '<span class="plan-goal-text">' + escapeHtml(goal) + "</span>"
            : "");
      }
    }
    fill(b);

    const mdPre = wrap.querySelector(".plan-md-preview");
    if (mdPre && o.planMarkdown) {
      mdPre.textContent = String(o.planMarkdown);
    }

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
      const hintLower = String(hint || "").toLowerCase();
      let matched = null;
      if (hintLower) {
        matched = items.find(function (li) {
          const box = li.querySelector('input[type="checkbox"]');
          if (box.checked) return false;
          const text = (li.querySelector("textarea").value || "").toLowerCase();
          return (
            text.indexOf(hintLower) >= 0 ||
            hintLower.indexOf(text.slice(0, 12)) >= 0
          );
        });
      }
      const open =
        matched ||
        items.find(function (li) {
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

    wrap.querySelector(".plan-continue").addEventListener("click", function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (ev && ev.stopPropagation) ev.stopPropagation();
      if (window.ChatreMotion && window.ChatreMotion.tap) {
        window.ChatreMotion.tap(wrap.querySelector(".plan-continue"));
      }
      const btn = wrap.querySelector(".plan-continue");
      const msg = wrap.querySelector(".plan-validate-msg");
      function fail(text) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Approve & continue";
        }
        if (msg) {
          msg.hidden = false;
          msg.textContent = text || "Could not continue";
          msg.className = "plan-validate-msg plan-validate-err";
        }
      }
      try {
        let steps = wrap.__collectSteps ? wrap.__collectSteps() : [];
        let files = fieldValue(".plan-files")
          .split("\n")
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean);
        let criteria = fieldValue(".plan-criteria")
          .split("\n")
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean);
        let goal = fieldValue(".plan-goal-input");
        let doneWhen = fieldValue(".plan-done-input");
        const assumptions = fieldValue(".plan-assumptions")
          .split("\n")
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean);
        const unknownsOrCorrections = fieldValue(".plan-unknowns")
          .split("\n")
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean);
        if (!goal) goal = String(b.goal || "Complete the user request").trim();
        if (!doneWhen && criteria.length) doneWhen = criteria[0];
        if (
          !doneWhen ||
          (window.ChatreUnderstanding &&
            window.ChatreUnderstanding.isSoftDoneWhen(doneWhen))
        ) {
          doneWhen =
            (criteria[0] &&
            !(
              window.ChatreUnderstanding &&
              window.ChatreUnderstanding.isSoftDoneWhen(criteria[0])
            )
              ? criteria[0]
              : "") ||
            (goal
              ? "Observable result matches: " + goal.slice(0, 160)
              : "");
        }
        if (!criteria.length && doneWhen) criteria = [doneWhen];
        if (!files.length) {
          const slug =
            String(b.project_slug || b.task_type || "app")
              .toLowerCase()
              .replace(/[^a-z0-9_-]+/g, "-")
              .replace(/^-+|-+$/g, "")
              .slice(0, 32) || "app";
          files =
            String(b.task_type || "") === "document"
              ? ["/home/user/documents/"]
              : ["/home/user/projects/" + slug + "/"];
          const filesEl = wrap.querySelector(".plan-files");
          if (filesEl) filesEl.value = files.join("\n");
        }
        if (steps.length < 2) {
          while (steps.length < 2) {
            steps.push({
              text:
                steps.length === 0
                  ? goal
                    ? "Implement: " + goal.slice(0, 120)
                    : "Implement the approved goal"
                  : doneWhen
                    ? "Verify: " + String(doneWhen).slice(0, 120)
                    : "Verify acceptance tests from the intent contract",
              done: false,
            });
            addCheckItem(steps[steps.length - 1].text, false);
          }
        }
        const next = Object.assign({}, b, {
          goal: goal,
          done_when: doneWhen,
          understanding: fieldValue(".plan-understanding"),
          executor_brief: fieldValue(".plan-brief"),
          assumptions: assumptions,
          unknowns: unknownsOrCorrections.filter(function (u) {
            return !/^(no|i meant|actually|correction)/i.test(u);
          }),
          user_corrections: unknownsOrCorrections,
          plan_steps: steps,
          approach: steps.map(function (s) {
            return s.text;
          }),
          files: files,
          todos: steps.map(function (s, i) {
            return {
              id: "t" + (i + 1),
              content: s.text,
              status: s.done ? "done" : "pending",
            };
          }),
          success_criteria: criteria,
          acceptance_tests: criteria,
        });
        if (window.ChatreUnderstanding) {
          next.deliverable_kind =
            next.deliverable_kind ||
            window.ChatreUnderstanding.classifyDeliverableKind(
              goal,
              next.task_type,
            );
          next.intent_contract =
            window.ChatreUnderstanding.formatIntentContract(next);
          const tid =
            (window.__chatreRemote && window.__chatreRemote.threadId) ||
            "local";
          unknownsOrCorrections.forEach(function (c) {
            window.ChatreUnderstanding.saveCorrection(tid, c);
          });
        }
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
        const errors = validatePlanBriefing(next);
        if (errors.length) {
          fail(errors.join(" · "));
          return;
        }
        if (msg) msg.hidden = true;
        if (btn) {
          btn.disabled = true;
          btn.textContent = "Starting…";
          btn.classList.add("is-loading");
        }
        Promise.resolve()
          .then(function () {
            if (typeof onContinue !== "function") {
              throw new Error("No continue handler attached");
            }
            return onContinue(next);
          })
          .then(function () {
            if (btn) {
              btn.textContent = "Approved";
              btn.classList.remove("is-loading");
              btn.classList.add("is-done");
            }
          })
          .catch(function (err) {
            fail((err && err.message) || "Could not continue");
            if (btn) btn.classList.remove("is-loading");
          });
      } catch (err) {
        fail((err && err.message) || "Could not continue");
      }
    });
    wrap.querySelector(".plan-cancel").addEventListener("click", function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (window.ChatreMotion && window.ChatreMotion.tap) {
        window.ChatreMotion.tap(wrap.querySelector(".plan-cancel"));
      }
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
    validatePlanBriefing: validatePlanBriefing,
    stepsFromBriefing: stepsFromBriefing,
  };
})();
