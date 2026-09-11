/**
 * Chatre browser automation — session tabs + computer-use tools.
 * Cloudflare Browser Rendering + Puppeteer (keep_alive session reuse).
 */
import type { Browser, Page, ElementHandle } from "@cloudflare/puppeteer";
import puppeteer from "@cloudflare/puppeteer";
import type { Env } from "./types";
import { captionScreenshot } from "./vision";

const VIEWPORT = { width: 1280, height: 800 };
const KEEP_ALIVE_MS = 600_000;

export interface BrowserRequestBody {
  tool?: string;
  action?: string;
  session_id?: string;
  tab_id?: number;
  thread_id?: string;
  caption?: boolean;
  url?: string;
  query?: string;
  queries?: string[];
  ref?: string;
  value?: string | boolean | number;
  text?: string;
  coordinate?: number[] | { x: number; y: number };
  x?: number;
  y?: number;
  depth?: number;
  filter?: string;
  ref_id?: string;
  scroll_parameters?: {
    scroll_direction?: string;
    scroll_amount?: number;
  };
  actions?: Array<Record<string, unknown>>;
  fullPage?: boolean;
  /** Legacy aliases */
  selector?: string;
  key?: string;
  script?: string;
  ms?: number;
  cookies?: Array<Record<string, unknown>>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, x-chatre-key",
    },
  });
}

export async function handleBrowserRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.BROWSER) {
    return jsonResponse(
      {
        ok: false,
        error:
          "Browser Rendering is not bound. Add browser binding in wrangler.jsonc and enable Browser Rendering on your Cloudflare account.",
      },
      503,
    );
  }

  let body: BrowserRequestBody;
  try {
    body = (await request.json()) as BrowserRequestBody;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }

  const tool = normalizeTool(body);

  // search_web does not need a live browser tab
  if (tool === "search_web") {
    try {
      const result = await searchWeb(body, env);
      return jsonResponse({ tool, ...result, ok: result.ok !== false });
    } catch (err) {
      return jsonResponse(
        {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    }
  }

  let browser: Browser | null = null;
  let launched = false;

  try {
    // Restore session_id from Durable Object when thread_id is provided.
    if (!body.session_id && body.thread_id && env.BROWSER_SESSIONS) {
      try {
        const id = env.BROWSER_SESSIONS.idFromName(String(body.thread_id));
        const stub = env.BROWSER_SESSIONS.get(id);
        const stored = await stub.fetch("https://do/get");
        const j = (await stored.json()) as { sessionId?: string; lastTabId?: number };
        if (j && j.sessionId) body.session_id = j.sessionId;
        if (body.tab_id == null && j && j.lastTabId != null) body.tab_id = j.lastTabId;
      } catch {
        /* ignore DO errors */
      }
    }

    const opened = await openBrowser(env, body.session_id);
    browser = opened.browser;
    launched = opened.launched;
    const sessionId = browserSessionId(browser);

    let result = await dispatch(browser, tool, body, env);

    // Optional vision caption for screenshots (computer / navigate snaps).
    if (
      (body.caption !== false) &&
      result &&
      typeof result.screenshot_base64 === "string" &&
      result.screenshot_base64
    ) {
      try {
        const cap = await captionScreenshot(
          env,
          String(result.screenshot_base64),
        );
        if (cap.ok && cap.caption) {
          result = { ...result, vision_caption: cap.caption, vision_model: cap.model };
        }
      } catch {
        /* ignore vision failures */
      }
    }

    await browser.disconnect();

    if (body.thread_id && env.BROWSER_SESSIONS && sessionId) {
      try {
        const id = env.BROWSER_SESSIONS.idFromName(String(body.thread_id));
        const stub = env.BROWSER_SESSIONS.get(id);
        await stub.fetch("https://do/set", {
          method: "POST",
          body: JSON.stringify({
            sessionId,
            lastTabId: result && result.tab_id != null ? result.tab_id : body.tab_id,
          }),
        });
      } catch {
        /* ignore */
      }
    }

    return jsonResponse({
      ok: true,
      tool,
      session_id: sessionId,
      launched,
      ...result,
    });
  } catch (err) {
    try {
      if (browser) await browser.disconnect();
    } catch {
      /* ignore */
    }
    return jsonResponse(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
}

function normalizeTool(body: BrowserRequestBody): string {
  if (body.tool) return String(body.tool);
  const a = String(body.action || "navigate");
  const legacy: Record<string, string> = {
    navigate: "navigate",
    click: "computer",
    type: "computer",
    press: "computer",
    screenshot: "computer",
    content: "get_page_text",
    evaluate: "computer",
    wait: "computer",
    scroll: "computer",
    tabs: "tabs_list",
  };
  return legacy[a] || a;
}

async function openBrowser(
  env: Env,
  sessionId?: string,
): Promise<{ browser: Browser; launched: boolean }> {
  if (sessionId) {
    try {
      const browser = await puppeteer.connect(env.BROWSER!, sessionId);
      return { browser, launched: false };
    } catch {
      /* fall through */
    }
  }
  const browser = await puppeteer.launch(env.BROWSER!, {
    keep_alive: KEEP_ALIVE_MS,
  } as never);
  return { browser, launched: true };
}

function browserSessionId(browser: Browser): string {
  try {
    const anyB = browser as unknown as {
      sessionId?: (() => string) | string;
    };
    if (typeof anyB.sessionId === "function") return String(anyB.sessionId());
    if (typeof anyB.sessionId === "string") return anyB.sessionId;
    return "";
  } catch {
    return "";
  }
}

async function dispatch(
  browser: Browser,
  tool: string,
  body: BrowserRequestBody,
  env?: Env,
): Promise<Record<string, unknown>> {
  switch (tool) {
    case "tabs_create":
      return tabsCreate(browser, body.url);
    case "tabs_list":
      return { tabs: await listTabs(browser) };
    case "navigate":
      return navigate(browser, body);
    case "computer":
      return computer(browser, body);
    case "read_page":
      return readPage(browser, body);
    case "find":
      return findElements(browser, body);
    case "form_input":
      return formInput(browser, body);
    case "get_page_text":
      return getPageText(browser, body);
    case "search_web":
      return searchWeb(body, env);
    // Legacy wrappers
    case "browser_navigate":
      return navigate(browser, { ...body, url: body.url });
    case "browser_screenshot":
      return computer(browser, { ...body, action: "screenshot" });
    case "browser_read":
    case "browser_content":
      return getPageText(browser, body);
    case "browser_click":
      return computer(browser, {
        ...body,
        action: "left_click",
        selector: body.selector,
      });
    case "browser_type":
      return computer(browser, {
        ...body,
        action: "type",
        text: body.text,
        selector: body.selector,
      });
    case "browser_press":
      return computer(browser, {
        ...body,
        action: "key",
        text: body.key || body.text,
      });
    case "browser_scroll":
      return computer(browser, {
        ...body,
        action: "scroll",
        scroll_parameters: {
          scroll_direction: "down",
          scroll_amount: Number(body.y) || 3,
        },
      });
    case "browser_wait":
      return computer(browser, { ...body, action: "wait" });
    case "browser_evaluate":
      return computer(browser, {
        ...body,
        action: "evaluate",
        text: body.script || body.text,
      });
    default:
      throw new Error("Unknown browser tool: " + tool);
  }
}

async function ensureTab(browser: Browser, tabId?: number): Promise<Page> {
  const pages = await browser.pages();
  if (!pages.length) {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await stampTab(page, 1);
    return page;
  }
  await ensureTabIds(pages);
  if (tabId == null) {
    return pages[pages.length - 1];
  }
  for (const p of pages) {
    const id = await getTabId(p);
    if (id === Number(tabId)) return p;
  }
  // Fallback: treat tab_id as 1-based index
  const idx = Number(tabId) - 1;
  if (idx >= 0 && idx < pages.length) return pages[idx];
  throw new Error("Unknown tab_id: " + tabId);
}

async function ensureTabIds(pages: Page[]) {
  let max = 0;
  const missing: Page[] = [];
  for (const p of pages) {
    const id = await getTabId(p);
    if (id == null) missing.push(p);
    else if (id > max) max = id;
  }
  for (const p of missing) {
    max += 1;
    await stampTab(p, max);
  }
}

async function getTabId(page: Page): Promise<number | null> {
  try {
    const id = await page.evaluate(
      "window.__CHATRE_TAB_ID__ != null ? window.__CHATRE_TAB_ID__ : null",
    );
    return id == null ? null : Number(id);
  } catch {
    return null;
  }
}

async function stampTab(page: Page, id: number) {
  try {
    await page.evaluate(
      "window.__CHATRE_TAB_ID__ = " + Number(id),
    );
  } catch {
    /* ignore */
  }
}

async function listTabs(browser: Browser) {
  const pages = await browser.pages();
  await ensureTabIds(pages);
  const tabs = [];
  for (const p of pages) {
    const tabId = await getTabId(p);
    let title = "";
    let url = "";
    try {
      title = await p.title();
      url = p.url();
    } catch {
      /* ignore */
    }
    tabs.push({ tab_id: tabId, title, url });
  }
  return tabs;
}

async function tabsCreate(browser: Browser, url?: string) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const pages = await browser.pages();
  await ensureTabIds(pages.filter((p) => p !== page));
  let max = 0;
  for (const p of pages) {
    if (p === page) continue;
    const id = await getTabId(p);
    if (id != null && id > max) max = id;
  }
  const tabId = max + 1;
  await stampTab(page, tabId);
  const target = normalizeUrl(url || "about:blank");
  if (target && target !== "about:blank") {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
  }
  return {
    tab_id: tabId,
    url: page.url(),
    title: await page.title(),
    tabs: await listTabs(browser),
  };
}

function normalizeUrl(raw: string): string {
  const u = String(raw || "").trim();
  if (!u || u === "about:blank") return "about:blank";
  if (u === "back" || u === "forward") return u;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("//")) return "https:" + u;
  return "https://" + u;
}

async function navigate(browser: Browser, body: BrowserRequestBody) {
  const page = await ensureTab(browser, body.tab_id);
  const raw = String(body.url || "").trim();
  if (!raw) throw new Error("url required");
  if (raw === "back") {
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(
      () => undefined,
    );
  } else if (raw === "forward") {
    await page
      .goForward({ waitUntil: "domcontentloaded", timeout: 30000 })
      .catch(() => undefined);
  } else {
    await page.goto(normalizeUrl(raw), {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
  }
  const snap = await snapshot(page, false);
  const tabId = await getTabId(page);
  return {
    tab_id: tabId,
    ...snap,
    id: "web:" + (tabId || 1),
    tabs: await listTabs(browser),
  };
}

async function computer(browser: Browser, body: BrowserRequestBody) {
  const page = await ensureTab(browser, body.tab_id);
  const actions =
    Array.isArray(body.actions) && body.actions.length
      ? body.actions
      : [body];

  let lastClick: { x: number; y: number } | null = null;
  for (const act of actions) {
    const action = String(
      (act as BrowserRequestBody).action || body.action || "screenshot",
    ).toLowerCase();
    const a = act as BrowserRequestBody;
    const coord = parseCoord(a.coordinate || a);
    const text = String(a.text != null ? a.text : body.text || "");
    const ref = String(a.ref || body.ref || "");
    const selector = String(a.selector || body.selector || "");

    if (action === "screenshot") {
      /* snapshot at end */
    } else if (action === "wait") {
      const ms = Math.min(Math.max(Number(a.ms || body.ms) || 800, 100), 15000);
      if (selector) await page.waitForSelector(selector, { timeout: ms });
      else await sleep(ms);
    } else if (action === "evaluate") {
      await page.evaluate(
        "new Function(" + JSON.stringify(text || body.script || "") + ")()",
      );
    } else if (
      action === "left_click" ||
      action === "click" ||
      action === "right_click" ||
      action === "double_click" ||
      action === "triple_click"
    ) {
      const point = await resolvePoint(page, { coord, ref, selector });
      lastClick = point;
      const button = action === "right_click" ? "right" : "left";
      const count =
        action === "triple_click" ? 3 : action === "double_click" ? 2 : 1;
      await page.mouse.click(point.x, point.y, { button, clickCount: count });
      await sleep(250);
    } else if (action === "type") {
      if (ref || selector) {
        const el = await resolveElement(page, ref, selector);
        if (el) {
          await el.click({ clickCount: 3 }).catch(() => undefined);
          await el.type(text, { delay: 15 });
        } else {
          await page.keyboard.type(text, { delay: 15 });
        }
      } else {
        await page.keyboard.type(text, { delay: 15 });
      }
    } else if (action === "key") {
      await pressKeys(page, text || String(body.key || "Enter"));
    } else if (action === "scroll") {
      const params = a.scroll_parameters || body.scroll_parameters || {};
      const dir = String(params.scroll_direction || "down").toLowerCase();
      const amount = Math.min(Math.max(Number(params.scroll_amount) || 3, 1), 20);
      const delta = amount * 240;
      const dx = dir === "left" ? -delta : dir === "right" ? delta : 0;
      const dy = dir === "up" ? -delta : dir === "down" ? delta : 0;
      if (coord) await page.mouse.move(coord.x, coord.y);
      await page.evaluate(
        "window.scrollBy(" + Number(dx) + "," + Number(dy) + ")",
      );
      await sleep(200);
    }
  }

  const snap = await snapshot(page, !!body.fullPage, lastClick);
  const tabId = await getTabId(page);
  return {
    tab_id: tabId,
    ...snap,
    id: "screenshot:" + (tabId || 1),
    tabs: await listTabs(browser),
  };
}

function parseCoord(
  c: unknown,
): { x: number; y: number } | null {
  if (!c) return null;
  if (Array.isArray(c) && c.length >= 2) {
    return { x: Number(c[0]), y: Number(c[1]) };
  }
  if (typeof c === "object") {
    const o = c as { x?: number; y?: number; coordinate?: number[] };
    if (Array.isArray(o.coordinate) && o.coordinate.length >= 2) {
      return { x: Number(o.coordinate[0]), y: Number(o.coordinate[1]) };
    }
    if (o.x != null && o.y != null) return { x: Number(o.x), y: Number(o.y) };
  }
  return null;
}

async function resolvePoint(
  page: Page,
  opts: {
    coord: { x: number; y: number } | null;
    ref: string;
    selector: string;
  },
): Promise<{ x: number; y: number }> {
  if (opts.coord) return opts.coord;
  const el = await resolveElement(page, opts.ref, opts.selector);
  if (!el) throw new Error("Need coordinate, ref, or selector to click");
  const box = await el.boundingBox();
  if (!box) throw new Error("Element has no bounding box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function resolveElement(
  page: Page,
  ref: string,
  selector: string,
): Promise<ElementHandle | null> {
  if (ref) {
    const handle = await page.evaluateHandle(
      `(function(){
        var map = window.__CHATRE_REFS__ || {};
        return map[${JSON.stringify(ref)}] || null;
      })()`,
    );
    const el = handle.asElement();
    if (el) return el as ElementHandle;
  }
  if (selector) {
    return page.$(selector);
  }
  return null;
}

async function pressKeys(page: Page, combo: string) {
  const parts = String(combo)
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean);
  const map: Record<string, string> = {
    return: "Enter",
    enter: "Enter",
    escape: "Escape",
    esc: "Escape",
    space: " ",
    ctrl: "Control",
    control: "Control",
    alt: "Alt",
    shift: "Shift",
    meta: "Meta",
    cmd: "Meta",
    tab: "Tab",
    backspace: "Backspace",
    delete: "Delete",
    home: "Home",
    end: "End",
  };
  const keys = parts.map((p) => map[p.toLowerCase()] || p);
  for (let i = 0; i < keys.length - 1; i++) {
    await page.keyboard.down(keys[i] as never);
  }
  await page.keyboard.press(keys[keys.length - 1] as never);
  for (let i = keys.length - 2; i >= 0; i--) {
    await page.keyboard.up(keys[i] as never);
  }
}

async function readPage(browser: Browser, body: BrowserRequestBody) {
  const page = await ensureTab(browser, body.tab_id);
  const depth = Math.min(Math.max(Number(body.depth) || 15, 1), 40);
  const filter = String(body.filter || "interactive").toLowerCase();
  const focusRef = String(body.ref_id || "");

  const tree = await page.evaluate(
    `(function(){
      var depth = ${depth};
      var filter = ${JSON.stringify(filter)};
      var focusRef = ${JSON.stringify(focusRef)};
      var refs = {};
      var n = 0;
      function isInteractive(el) {
        if (!el || el.nodeType !== 1) return false;
        var tag = el.tagName.toLowerCase();
        if (["a","button","input","select","textarea","summary"].indexOf(tag) >= 0) return true;
        var role = (el.getAttribute("role") || "").toLowerCase();
        if (["button","link","textbox","checkbox","radio","menuitem","tab","switch"].indexOf(role) >= 0) return true;
        if (el.tabIndex >= 0) return true;
        if (typeof el.onclick === "function") return true;
        return false;
      }
      function visible(el) {
        try {
          var s = window.getComputedStyle(el);
          if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
          var r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        } catch (e) { return false; }
      }
      function walk(el, d, out) {
        if (!el || d > depth || out.length > 250) return;
        if (el.nodeType !== 1) return;
        if (!visible(el)) return;
        var interactive = isInteractive(el);
        if (filter === "interactive" && !interactive && d > 0) {
          var kids = el.children || [];
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
          text: ((el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim()).slice(0, 120),
          href: el.href || "",
          coordinate: [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)],
          depth: d
        });
        var children = el.children || [];
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
    })()`,
  );

  const tabId = await getTabId(page);
  return {
    tab_id: tabId,
    url: page.url(),
    title: await page.title(),
    elements: tree,
    id: "web:" + (tabId || 1),
    tabs: await listTabs(browser),
  };
}

async function findElements(browser: Browser, body: BrowserRequestBody) {
  const page = await ensureTab(browser, body.tab_id);
  const query = String(body.query || "").trim().toLowerCase();
  if (!query) throw new Error("query required");

  // Build / refresh refs then filter by query tokens
  const read = await readPage(browser, { ...body, filter: "all", depth: 20 });
  const elements = Array.isArray(read.elements) ? read.elements : [];
  const tokens = query.split(/\s+/).filter(Boolean);
  const scored = elements
    .map((el: Record<string, unknown>) => {
      const hay = [
        el.text,
        el.tag,
        el.role,
        el.name,
        el.id,
        el.type,
        el.href,
      ]
        .join(" ")
        .toLowerCase();
      let score = 0;
      for (const t of tokens) if (hay.includes(t)) score += 1;
      return { el, score };
    })
    .filter((x: { score: number }) => x.score > 0)
    .sort(
      (a: { score: number }, b: { score: number }) => b.score - a.score,
    )
    .slice(0, 20)
    .map((x: { el: Record<string, unknown> }) => x.el);

  return {
    tab_id: read.tab_id,
    url: read.url,
    title: read.title,
    query,
    matches: scored,
    id: read.id,
    tabs: read.tabs,
  };
}

async function formInput(browser: Browser, body: BrowserRequestBody) {
  const page = await ensureTab(browser, body.tab_id);
  const ref = String(body.ref || "");
  if (!ref) throw new Error("ref required");
  const value = body.value;

  const ok = await page.evaluate(
    `(function(){
      var el = (window.__CHATRE_REFS__ || {})[${JSON.stringify(ref)}];
      if (!el) return { ok: false, error: "Unknown ref" };
      var tag = el.tagName.toLowerCase();
      var type = (el.getAttribute("type") || "").toLowerCase();
      var val = ${JSON.stringify(value)};
      if (type === "checkbox" || type === "radio" || tag === "input" && (type === "checkbox" || type === "radio")) {
        el.checked = !!val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, kind: "check", checked: !!el.checked };
      }
      if (tag === "select") {
        el.value = String(val);
        var opts = Array.from(el.options || []);
        var hit = opts.find(function(o){ return o.value === String(val) || o.text === String(val); });
        if (hit) el.value = hit.value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, kind: "select", value: el.value };
      }
      el.focus();
      el.value = String(val == null ? "" : val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, kind: "text", value: el.value };
    })()`,
  );

  const snap = await snapshot(page, false);
  const tabId = await getTabId(page);
  return {
    tab_id: tabId,
    ref,
    result: ok,
    ...snap,
    id: "web:" + (tabId || 1),
    tabs: await listTabs(browser),
  };
}

async function getPageText(browser: Browser, body: BrowserRequestBody) {
  const page = await ensureTab(browser, body.tab_id);
  const text = await page.evaluate(`(function(){
    var main = document.querySelector("article, main, [role='main']") || document.body;
    return (main && main.innerText) ? main.innerText : "";
  })()`);
  const tabId = await getTabId(page);
  return {
    tab_id: tabId,
    url: page.url(),
    title: await page.title(),
    text: String(text).slice(0, 60000),
    id: "web:" + (tabId || 1),
    tabs: await listTabs(browser),
  };
}

async function searchWeb(body: BrowserRequestBody, env?: Env) {
  const queries = Array.isArray(body.queries)
    ? body.queries.map(String).filter(Boolean).slice(0, 3)
    : String(body.query || "")
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);
  if (!queries.length) throw new Error("queries required");

  const results: Array<Record<string, unknown>> = [];
  let webIndex = 0;
  const braveKey = env && env.BRAVE_API_KEY;

  for (const q of queries) {
    let got = 0;
    if (braveKey) {
      try {
        const res = await fetch(
          "https://api.search.brave.com/res/v1/web/search?q=" +
            encodeURIComponent(q) +
            "&count=5",
          {
            headers: {
              Accept: "application/json",
              "X-Subscription-Token": braveKey,
            },
          },
        );
        if (res.ok) {
          const data = (await res.json()) as {
            web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
          };
          for (const r of (data.web && data.web.results) || []) {
            webIndex += 1;
            got += 1;
            results.push({
              id: "web:" + webIndex,
              query: q,
              title: r.title || "",
              url: r.url || "",
              snippet: r.description || r.title || "",
              source: "brave",
            });
          }
        }
      } catch {
        /* fall through */
      }
    }

    if (got === 0) {
      // DuckDuckGo Instant Answer + HTML fallback
      try {
        const ia = await fetch(
          "https://api.duckduckgo.com/?q=" +
            encodeURIComponent(q) +
            "&format=json&no_html=1&skip_disambig=1",
        );
        if (ia.ok) {
          const data = (await ia.json()) as {
            AbstractText?: string;
            AbstractURL?: string;
            Heading?: string;
            RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
          };
          if (data.AbstractText && data.AbstractURL) {
            webIndex += 1;
            got += 1;
            results.push({
              id: "web:" + webIndex,
              query: q,
              title: data.Heading || q,
              url: data.AbstractURL,
              snippet: data.AbstractText,
              source: "duckduckgo_ia",
            });
          }
          for (const t of (data.RelatedTopics || []).slice(0, 4)) {
            if (!t.FirstURL || !t.Text) continue;
            webIndex += 1;
            got += 1;
            results.push({
              id: "web:" + webIndex,
              query: q,
              title: t.Text.slice(0, 80),
              url: t.FirstURL,
              snippet: t.Text,
              source: "duckduckgo_ia",
            });
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (got === 0) {
      const url =
        "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q);
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; ChatreBot/1.0; +https://chatre)",
        },
      });
      const html = await res.text();
      const re =
        /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      let count = 0;
      while ((m = re.exec(html)) && count < 5) {
        webIndex += 1;
        count += 1;
        const href = decodeDuckHref(m[1]);
        const title = stripTags(m[2]).trim();
        results.push({
          id: "web:" + webIndex,
          query: q,
          title,
          url: href,
          snippet: title,
          source: "duckduckgo_html",
        });
      }
    }
  }
  return { ok: true, results, queries };
}

function decodeDuckHref(href: string): string {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    return href;
  } catch {
    return href;
  }
}

function stripTags(s: string): string {
  return String(s || "").replace(/<[^>]+>/g, "");
}

async function snapshot(
  page: Page,
  fullPage: boolean,
  clickDot?: { x: number; y: number } | null,
) {
  if (clickDot) {
    try {
      await page.evaluate(
        `(function(){
          var d = document.createElement("div");
          d.id = "__chatre_click_dot";
          d.style.cssText = "position:fixed;left:${Math.round(clickDot.x) - 6}px;top:${Math.round(clickDot.y) - 6}px;width:12px;height:12px;border-radius:50%;background:#3b82f6;z-index:2147483647;pointer-events:none;box-shadow:0 0 0 2px #fff;";
          document.body.appendChild(d);
          setTimeout(function(){ try{d.remove();}catch(e){} }, 1500);
        })()`,
      );
    } catch {
      /* ignore */
    }
  }

  const text = await page.evaluate(
    "document.body ? document.body.innerText : ''",
  );
  const screenshot = await page.screenshot({
    encoding: "base64",
    fullPage: !!fullPage,
    type: "jpeg",
    quality: 55,
  });

  return {
    url: page.url(),
    title: await page.title(),
    text: String(text).slice(0, 16000),
    screenshot_base64: screenshot,
    mime: "image/jpeg",
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
