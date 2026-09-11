/**
 * DOM helpers for more reliable browser automation (shadow DOM, waits, React inputs).
 */
import type { Page, ElementHandle } from "@cloudflare/puppeteer";

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wait until DOM size + URL settle briefly (SPA-friendly). */
export async function waitForStable(
  page: Page,
  opts?: { quietMs?: number; timeoutMs?: number },
): Promise<{ stable: boolean; url: string; waitedMs: number }> {
  const quietMs = Math.min(Math.max(opts?.quietMs || 450, 150), 3000);
  const timeoutMs = Math.min(Math.max(opts?.timeoutMs || 8000, 500), 20000);
  const start = Date.now();
  let lastSig = "";
  let lastChange = Date.now();

  while (Date.now() - start < timeoutMs) {
    let sig = "";
    try {
      sig = String(
        await page.evaluate(`(function(){
          var b = document.body;
          return location.href + "|" + (b ? b.innerText.length : 0) + "|" + document.querySelectorAll("*").length;
        })()`),
      );
    } catch {
      await sleep(120);
      continue;
    }
    if (sig !== lastSig) {
      lastSig = sig;
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= quietMs) {
      return {
        stable: true,
        url: page.url(),
        waitedMs: Date.now() - start,
      };
    }
    await sleep(120);
  }
  return {
    stable: false,
    url: page.url(),
    waitedMs: Date.now() - start,
  };
}

export async function pageHealth(page: Page): Promise<Record<string, unknown>> {
  try {
    return (await page.evaluate(`(function(){
      var dialogs = document.querySelectorAll("[role='dialog'], [aria-modal='true'], .modal, .Modal");
      var captcha = !!(document.querySelector("iframe[src*='captcha'], iframe[src*='recaptcha'], iframe[src*='hcaptcha'], [class*='captcha' i], #captcha"));
      var text = (document.body && document.body.innerText) ? document.body.innerText : "";
      return {
        url: location.href,
        title: document.title || "",
        dialog_open: dialogs.length > 0,
        captcha_likely: captcha,
        text_head: text.slice(0, 500),
        interactive_approx: document.querySelectorAll("a,button,input,select,textarea,[role='button'],[role='link'],[role='textbox']").length
      };
    })()`)) as Record<string, unknown>;
  } catch {
    return { url: page.url(), title: "", error: "health_unavailable" };
  }
}

export async function clearRefs(page: Page) {
  try {
    await page.evaluate("window.__CHATRE_REFS__ = {}");
  } catch {
    /* ignore */
  }
}

export async function scrollIntoViewHandle(el: ElementHandle) {
  try {
    await el.evaluate((node) => {
      const html = node as unknown as {
        scrollIntoView: (arg?: boolean | Record<string, string>) => void;
      };
      try {
        html.scrollIntoView({
          block: "center",
          inline: "center",
          behavior: "auto",
        });
      } catch {
        try {
          html.scrollIntoView();
        } catch {
          /* ignore */
        }
      }
    });
    await sleep(80);
  } catch {
    /* ignore */
  }
}

/** Prefer real element click (ref) over raw mouse when possible. */
export async function clickViaRef(
  page: Page,
  ref: string,
  opts?: { button?: "left" | "right"; clickCount?: number },
): Promise<{ ok: boolean; point?: { x: number; y: number }; error?: string }> {
  const button = opts?.button || "left";
  const clickCount = opts?.clickCount || 1;
  const handle = await page.evaluateHandle(
    `(function(){
      var map = window.__CHATRE_REFS__ || {};
      return map[${JSON.stringify(ref)}] || null;
    })()`,
  );
  const el = handle.asElement() as ElementHandle | null;
  if (!el) {
    return { ok: false, error: "Unknown ref: " + ref };
  }
  await scrollIntoViewHandle(el);
  let point: { x: number; y: number } | undefined;
  try {
    const box = await el.boundingBox();
    if (box) {
      point = {
        x: Math.round(box.x + box.width / 2),
        y: Math.round(box.y + box.height / 2),
      };
    }
  } catch {
    /* ignore */
  }
  try {
    await el.click({ button, clickCount, delay: 20 });
    return { ok: true, point };
  } catch (err) {
    if (point) {
      await page.mouse.click(point.x, point.y, { button, clickCount });
      return { ok: true, point };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * read_page walker: pierces open shadow roots, builds __CHATRE_REFS__.
 */
export function buildReadPageScript(
  depth: number,
  filter: string,
  focusRef: string,
): string {
  return `(function(){
    var depth = ${depth};
    var filter = ${JSON.stringify(filter)};
    var focusRef = ${JSON.stringify(focusRef)};
    var refs = {};
    var n = 0;
    function isInteractive(el) {
      if (!el || el.nodeType !== 1) return false;
      var tag = el.tagName.toLowerCase();
      if (["a","button","input","select","textarea","summary","label","option"].indexOf(tag) >= 0) return true;
      var role = (el.getAttribute("role") || "").toLowerCase();
      if (["button","link","textbox","checkbox","radio","menuitem","tab","switch","combobox","option","searchbox"].indexOf(role) >= 0) return true;
      if (el.tabIndex >= 0) return true;
      if (el.isContentEditable) return true;
      if (typeof el.onclick === "function") return true;
      return false;
    }
    function visible(el) {
      try {
        var s = window.getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
        var r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      } catch (e) { return false; }
    }
    function labelText(el) {
      var bits = [
        el.getAttribute("aria-label"),
        el.getAttribute("placeholder"),
        el.getAttribute("title"),
        el.getAttribute("alt"),
        el.getAttribute("name"),
        el.id ? ("#" + el.id) : "",
        el.value,
        el.innerText
      ];
      return bits.filter(Boolean).join(" ").replace(/\\s+/g, " ").trim().slice(0, 160);
    }
    function childNodes(el) {
      var out = [];
      var kids = el.children || [];
      for (var i = 0; i < kids.length; i++) out.push(kids[i]);
      if (el.shadowRoot) {
        var sKids = el.shadowRoot.children || [];
        for (var j = 0; j < sKids.length; j++) out.push(sKids[j]);
      }
      return out;
    }
    function walk(el, d, out) {
      if (!el || d > depth || out.length > 280) return;
      if (el.nodeType !== 1) return;
      if (!visible(el)) {
        var hiddenKids = childNodes(el);
        for (var h = 0; h < hiddenKids.length; h++) walk(hiddenKids[h], d + 1, out);
        return;
      }
      var interactive = isInteractive(el);
      if (filter === "interactive" && !interactive && d > 0) {
        var kids = childNodes(el);
        for (var i = 0; i < kids.length; i++) walk(kids[i], d + 1, out);
        return;
      }
      n += 1;
      var ref = "ref_" + n;
      refs[ref] = el;
      var r = el.getBoundingClientRect();
      out.push({
        ref: ref,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || "",
        name: el.getAttribute("name") || "",
        id: el.id || "",
        type: el.getAttribute("type") || "",
        text: labelText(el),
        href: el.href || "",
        disabled: !!(el.disabled || el.getAttribute("aria-disabled") === "true"),
        coordinate: [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)],
        bbox: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        depth: d,
        shadow: !!(el.getRootNode && el.getRootNode() instanceof ShadowRoot)
      });
      var children = childNodes(el);
      for (var j = 0; j < children.length; j++) walk(children[j], d + 1, out);
    }
    var root = document.body;
    if (focusRef && window.__CHATRE_REFS__ && window.__CHATRE_REFS__[focusRef]) {
      root = window.__CHATRE_REFS__[focusRef];
    }
    var out = [];
    walk(root, 0, out);
    window.__CHATRE_REFS__ = refs;
    return out;
  })()`;
}

/** React-aware form fill by ref. */
export function buildFormInputScript(ref: string, value: unknown): string {
  return `(function(){
    var el = (window.__CHATRE_REFS__ || {})[${JSON.stringify(ref)}];
    if (!el) return { ok: false, error: "Unknown ref" };
    try {
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    } catch (e) {
      try { el.scrollIntoView(); } catch (e2) {}
    }
    var tag = el.tagName.toLowerCase();
    var type = (el.getAttribute("type") || "").toLowerCase();
    var val = ${JSON.stringify(value)};
    function fire(el) {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      try {
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: String(val == null ? "" : val) }));
      } catch (e) {}
    }
    function setNative(el, value) {
      var proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
      var desc = proto && Object.getOwnPropertyDescriptor(proto, "value");
      if (desc && desc.set) desc.set.call(el, value);
      else el.value = value;
    }
    if (type === "checkbox" || type === "radio" || (tag === "input" && (type === "checkbox" || type === "radio"))) {
      var want = !!val;
      if (el.checked !== want) el.click();
      el.checked = want;
      fire(el);
      return { ok: true, kind: "check", checked: !!el.checked };
    }
    if (tag === "select") {
      el.focus();
      var opts = Array.from(el.options || []);
      var hit = opts.find(function(o){
        return o.value === String(val) || (o.text || "").trim() === String(val).trim();
      });
      if (hit) el.value = hit.value;
      else el.value = String(val);
      fire(el);
      return { ok: true, kind: "select", value: el.value };
    }
    el.focus();
    if (el.isContentEditable) {
      el.textContent = String(val == null ? "" : val);
      fire(el);
      return { ok: true, kind: "contenteditable", value: el.textContent };
    }
    setNative(el, String(val == null ? "" : val));
    fire(el);
    return { ok: true, kind: "text", value: el.value };
  })()`;
}
