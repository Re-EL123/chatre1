/**
 * Chatre browser automation — session tabs + computer-use tools.
 * Cloudflare Browser Rendering + Puppeteer (keep_alive session reuse).
 */
import type { Browser, Page, ElementHandle } from "@cloudflare/puppeteer";
import puppeteer from "@cloudflare/puppeteer";
import type { Env } from "./types";
import { captionScreenshot } from "./vision";
import {
  buildFormInputScript,
  buildReadPageScript,
  clearRefs,
  clickViaRef,
  pageHealth,
  scrollIntoViewHandle,
  sleep,
  waitForStable,
} from "./browser-dom";

const VIEWPORT = { width: 1280, height: 800 };
const KEEP_ALIVE_MS = 1_800_000; // 30 minutes

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
  wait_stable?: boolean;
  frame_selector?: string;
  frame_url?: string;
  frame_index?: number;
  accept_downloads?: boolean;
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
  let sessionRecovered = false;

  try {
    // Restore session_id + cookies from Durable Object when thread_id is provided.
    let storedCookies: Array<Record<string, unknown>> = [];
    if (!body.session_id && body.thread_id && env.BROWSER_SESSIONS) {
      try {
        const id = env.BROWSER_SESSIONS.idFromName(String(body.thread_id));
        const stub = env.BROWSER_SESSIONS.get(id);
        const stored = await stub.fetch("https://do/get");
        const j = (await stored.json()) as {
          sessionId?: string;
          lastTabId?: number;
          cookies?: Array<Record<string, unknown>>;
        };
        if (j && j.sessionId) body.session_id = j.sessionId;
        if (body.tab_id == null && j && j.lastTabId != null) {
          body.tab_id = j.lastTabId;
        }
        if (Array.isArray(j.cookies)) storedCookies = j.cookies;
      } catch {
        /* ignore DO errors */
      }
    }
    if (Array.isArray(body.cookies) && body.cookies.length) {
      storedCookies = body.cookies;
    }

    const priorSession = body.session_id;
    const opened = await openBrowser(env, body.session_id);
    browser = opened.browser;
    launched = opened.launched;
    sessionRecovered = !!(priorSession && opened.launched);
    if (sessionRecovered) {
      // Old tab_id is meaningless after a fresh launch.
      body.tab_id = undefined;
    }
    const sessionId = browserSessionId(browser);

    // Restore cookie profile onto default page before navigation tools
    if (storedCookies.length) {
      try {
        const pages = await browser.pages();
        const page = pages[0] || (await browser.newPage());
        for (const c of storedCookies.slice(0, 200)) {
          try {
            await page.setCookie(c as never);
          } catch {
            /* skip invalid cookie */
          }
        }
      } catch {
        /* ignore bad cookies */
      }
    }

    // Download capture setup on target tab
    const downloadBuf: Array<Record<string, unknown>> = [];
    try {
      const page = await ensureTab(browser, body.tab_id);
      await attachDownloadListener(page, downloadBuf);
    } catch {
      /* ignore */
    }

    let result = await dispatch(browser, tool, body, env);

    if (downloadBuf.length) {
      result = { ...result, downloads: downloadBuf.slice(0, 10) };
    }

    // Persist cookies back to DO profile
    let cookiesOut: Array<Record<string, unknown>> = [];
    try {
      const page = await ensureTab(browser, (result.tab_id as number) || body.tab_id);
      cookiesOut = (await page.cookies()) as unknown as Array<
        Record<string, unknown>
      >;
    } catch {
      /* ignore */
    }

    // Optional vision caption for screenshots (computer / navigate snaps).
    if (
      body.caption !== false &&
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
          result = {
            ...result,
            vision_caption: cap.caption,
            vision_model: cap.model,
          };
        }
      } catch {
        /* ignore vision failures */
      }
    }

    // Structured action trace for UI replay
    if (result && !result.action_trace) {
      result = {
        ...result,
        action_trace: {
          tool,
          tab_id: result.tab_id,
          url: result.url,
          notes: result.action_notes || [],
          health: result.health || null,
          ts: Date.now(),
        },
      };
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
            lastTabId:
              result && result.tab_id != null ? result.tab_id : body.tab_id,
            cookies: cookiesOut.slice(0, 400),
            profileKey: String(body.thread_id),
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
      session_recovered: sessionRecovered || undefined,
      cookies_saved: cookiesOut.length || undefined,
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
    case "list_frames":
      return listFrames(browser, body);
    case "switch_frame":
      return switchFrameInfo(browser, body);
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
  // After session recovery, fall back to newest tab instead of failing hard.
  return pages[pages.length - 1];
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
    await waitForStable(page, { quietMs: 350, timeoutMs: 5000 });
  }
  return {
    tab_id: tabId,
    url: page.url(),
    title: await page.title(),
    health: await pageHealth(page),
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
  await clearRefs(page);
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
  const stable =
    body.wait_stable === false
      ? { stable: true, url: page.url(), waitedMs: 0 }
      : await waitForStable(page, { quietMs: 400, timeoutMs: 6000 });
  const health = await pageHealth(page);
  const snap = await snapshot(page, false);
  const tabId = await getTabId(page);
  return {
    tab_id: tabId,
    ...snap,
    stable,
    health,
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
  const actionNotes: string[] = [];
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
    } else if (action === "wait" || action === "wait_stable") {
      if (action === "wait_stable" || (!selector && !text)) {
        const st = await waitForStable(page, {
          quietMs: Number(a.ms || body.ms) || 450,
          timeoutMs: 8000,
        });
        actionNotes.push(
          "wait_stable:" + (st.stable ? "ok" : "timeout") + ":" + st.waitedMs + "ms",
        );
      } else {
        const ms = Math.min(Math.max(Number(a.ms || body.ms) || 800, 100), 15000);
        if (selector) await page.waitForSelector(selector, { timeout: ms });
        else if (text) {
          await page
            .waitForFunction(
              "document.body && document.body.innerText.toLowerCase().includes(" +
                JSON.stringify(text.toLowerCase()) +
                ")",
              { timeout: ms },
            )
            .catch(() => undefined);
        } else await sleep(ms);
      }
    } else if (action === "hover") {
      const point = await resolvePoint(page, { coord, ref, selector });
      await page.mouse.move(point.x, point.y);
      await sleep(120);
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
      const button = action === "right_click" ? "right" : "left";
      const count =
        action === "triple_click" ? 3 : action === "double_click" ? 2 : 1;
      if (ref) {
        let via = await clickViaRef(page, ref, { button, clickCount: count });
        if (!via.ok) {
          // Refresh refs once, then retry by text/role match from find tokens.
          await readPage(browser, {
            ...body,
            filter: "interactive",
            depth: 18,
          });
          via = await clickViaRef(page, ref, { button, clickCount: count });
        }
        if (via.ok && via.point) {
          lastClick = via.point;
          actionNotes.push("click:ref:" + ref);
        } else {
          const point = await resolvePoint(page, { coord, ref: "", selector });
          lastClick = point;
          await page.mouse.click(point.x, point.y, { button, clickCount: count });
          actionNotes.push("click:coord_fallback");
        }
      } else {
        const point = await resolvePoint(page, { coord, ref, selector });
        lastClick = point;
        await page.mouse.click(point.x, point.y, { button, clickCount: count });
        actionNotes.push("click:coord");
      }
      await sleep(200);
      if (body.wait_stable !== false) {
        await waitForStable(page, { quietMs: 350, timeoutMs: 5000 });
      }
    } else if (action === "type") {
      if (ref || selector) {
        const el = await resolveElement(page, ref, selector);
        if (el) {
          await scrollIntoViewHandle(el);
          await el.click({ clickCount: 3 }).catch(() => undefined);
          await el.type(text, { delay: 12 });
        } else {
          await page.keyboard.type(text, { delay: 12 });
        }
      } else {
        await page.keyboard.type(text, { delay: 12 });
      }
    } else if (action === "key") {
      await pressKeys(page, text || String(body.key || "Enter"));
      if (body.wait_stable !== false) {
        await waitForStable(page, { quietMs: 300, timeoutMs: 4000 });
      }
    } else if (action === "scroll") {
      const params = a.scroll_parameters || body.scroll_parameters || {};
      const dir = String(params.scroll_direction || "down").toLowerCase();
      const amount = Math.min(
        Math.max(Number(params.scroll_amount) || 3, 1),
        20,
      );
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

  const health = await pageHealth(page);
  const snap = await snapshot(page, !!body.fullPage, lastClick);
  const tabId = await getTabId(page);
  return {
    tab_id: tabId,
    ...snap,
    health,
    action_notes: actionNotes.length ? actionNotes : undefined,
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
  await scrollIntoViewHandle(el);
  const box = await el.boundingBox();
  if (!box) throw new Error("Element has no bounding box");
  return {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };
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
    buildReadPageScript(depth, filter, focusRef),
  );

  const health = await pageHealth(page);
  const tabId = await getTabId(page);
  return {
    tab_id: tabId,
    url: page.url(),
    title: await page.title(),
    elements: tree,
    health,
    id: "web:" + (tabId || 1),
    tabs: await listTabs(browser),
  };
}

async function findElements(browser: Browser, body: BrowserRequestBody) {
  const page = await ensureTab(browser, body.tab_id);
  const query = String(body.query || "").trim().toLowerCase();
  if (!query) throw new Error("query required");

  // Also index content from matching iframes when possible
  const frameExtras = await collectFrameElements(page, body);

  const read = await readPage(browser, { ...body, filter: "all", depth: 22 });
  const elements = [
    ...(Array.isArray(read.elements) ? read.elements : []),
    ...frameExtras,
  ];
  const tokens = query.split(/\s+/).filter(Boolean);
  const scored = elements
    .map((el: Record<string, unknown>) => {
      const role = String(el.role || "").toLowerCase();
      const accessible = String(
        el.accessible_name || el.text || "",
      ).toLowerCase();
      const hay = [
        el.accessible_name,
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
      // Role + accessible name preferred
      if (accessible === query) score += 12;
      if (accessible.includes(query)) score += 8;
      if (role && query.includes(role)) score += 4;
      if (hay.includes(query)) score += tokens.length + 3;
      for (const t of tokens) {
        if (accessible.includes(t)) score += 2;
        if (hay.includes(t)) score += 1;
        if (String(el.text || "").toLowerCase() === t) score += 2;
        if (String(el.text || "").toLowerCase().startsWith(t)) score += 1;
      }
      // Fuzzy: shared prefix length
      if (accessible && query) {
        let i = 0;
        while (
          i < accessible.length &&
          i < query.length &&
          accessible[i] === query[i]
        )
          i++;
        if (i >= 3) score += Math.min(i, 6);
      }
      if (el.disabled) score -= 2;
      if (el.frame) score += 1;
      return { el, score };
    })
    .filter((x: { score: number }) => x.score > 0)
    .sort(
      (a: { score: number }, b: { score: number }) => b.score - a.score,
    )
    .slice(0, 20)
    .map((x: { el: Record<string, unknown>; score: number }) => ({
      ...x.el,
      score: x.score,
    }));

  return {
    tab_id: read.tab_id,
    url: read.url,
    title: read.title,
    query,
    matches: scored,
    health: read.health,
    id: read.id,
    tabs: read.tabs,
  };
}

async function formInput(browser: Browser, body: BrowserRequestBody) {
  const page = await ensureTab(browser, body.tab_id);
  let ref = String(body.ref || "");
  if (!ref) throw new Error("ref required");
  const value = body.value;

  let ok = await page.evaluate(buildFormInputScript(ref, value));
  if (
    ok &&
    typeof ok === "object" &&
    (ok as { ok?: boolean }).ok === false
  ) {
    // Stale ref — refresh interactive tree once and retry same ref id if present,
    // else try best text match when value looks like a label request.
    await readPage(browser, { ...body, filter: "interactive", depth: 18 });
    ok = await page.evaluate(buildFormInputScript(ref, value));
  }

  if (
    ok &&
    typeof ok === "object" &&
    (ok as { ok?: boolean }).ok === false &&
    !/^ref_\d+$/i.test(ref)
  ) {
    const found = await findElements(browser, {
      ...body,
      query: String(ref),
    });
    const first =
      Array.isArray(found.matches) && found.matches[0]
        ? (found.matches[0] as { ref?: string })
        : null;
    if (first && first.ref) {
      ref = String(first.ref);
      ok = await page.evaluate(buildFormInputScript(ref, value));
    }
  }

  await waitForStable(page, { quietMs: 250, timeoutMs: 2500 });
  const health = await pageHealth(page);
  const snap = await snapshot(page, false);
  const tabId = await getTabId(page);
  return {
    tab_id: tabId,
    ref,
    result: ok,
    health,
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
    health: await pageHealth(page),
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

  const ranked = rankAndDedupeSearch(results);
  return {
    ok: true,
    results: ranked,
    queries,
    brave_configured: !!braveKey,
    note: braveKey
      ? undefined
      : "BRAVE_API_KEY not set — using DuckDuckGo fallbacks. Set Worker secret for stronger search.",
  };
}

function rankAndDedupeSearch(
  results: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const scored = results
    .map((r, idx) => {
      const url = String(r.url || "").toLowerCase();
      const title = String(r.title || "");
      const snippet = String(r.snippet || "");
      const source = String(r.source || "");
      let score = 10 - Math.min(idx, 9);
      if (source === "brave") score += 5;
      if (source === "duckduckgo_ia") score += 2;
      if (title.length > 12) score += 1;
      if (snippet.length > 40) score += 1;
      if (/wikipedia\.org|docs\.|developer\.|github\.com|mdn\./.test(url)) {
        score += 2;
      }
      return { r, score, url };
    })
    .filter((x) => {
      if (!x.url || seen.has(x.url)) return false;
      seen.add(x.url);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);

  return scored.map((x, i) => ({
    ...x.r,
    id: "web:" + (i + 1),
    rank: i + 1,
    score: x.score,
  }));
}

async function attachDownloadListener(
  page: Page,
  buf: Array<Record<string, unknown>>,
) {
  try {
    const client = await (page as unknown as { createCDPSession?: () => Promise<{ send: (m: string, p?: object) => Promise<unknown> }> }).createCDPSession?.();
    if (!client) return;
    await client.send("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: "/tmp/chatre-downloads",
    });
    page.on("response", async (res) => {
      try {
        const headers = res.headers();
        const cd = headers["content-disposition"] || "";
        const ct = headers["content-type"] || "";
        if (
          /attachment/i.test(cd) ||
          /octet-stream|zip|pdf|csv/i.test(ct)
        ) {
          buf.push({
            url: res.url(),
            content_type: ct,
            content_disposition: cd,
            status: res.status(),
            needs_confirmation: true,
          });
        }
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* CDP unavailable */
  }
}

async function listFrames(browser: Browser, body: BrowserRequestBody) {
  const page = await ensureTab(browser, body.tab_id);
  const frames = page.frames().map((f, index) => ({
    index,
    url: f.url(),
    name: f.name(),
  }));
  const health = await pageHealth(page);
  const tabId = await getTabId(page);
  return {
    tab_id: tabId,
    frames,
    health,
    url: page.url(),
    title: await page.title(),
  };
}

async function switchFrameInfo(browser: Browser, body: BrowserRequestBody) {
  const page = await ensureTab(browser, body.tab_id);
  const frame = await resolveFrame(page, body);
  if (!frame) {
    return {
      ok: false,
      error: "Frame not found — pass frame_index, frame_url, or frame_selector",
      frames: page.frames().map((f, index) => ({
        index,
        url: f.url(),
        name: f.name(),
      })),
    };
  }
  const elements = await frame.evaluate(buildReadPageScript(12, "interactive", ""));
  return {
    ok: true,
    frame: { url: frame.url(), name: frame.name() },
    elements,
    tab_id: await getTabId(page),
  };
}

async function resolveFrame(page: Page, body: BrowserRequestBody) {
  const frames = page.frames();
  if (body.frame_index != null) {
    const idx = Number(body.frame_index);
    if (idx >= 0 && idx < frames.length) return frames[idx];
  }
  if (body.frame_url) {
    const needle = String(body.frame_url).toLowerCase();
    const hit = frames.find((f) => f.url().toLowerCase().includes(needle));
    if (hit) return hit;
  }
  if (body.frame_selector) {
    const handle = await page.$(String(body.frame_selector));
    if (handle) {
      const frame = await handle.contentFrame();
      if (frame) return frame;
    }
  }
  return null;
}

async function collectFrameElements(
  page: Page,
  body: BrowserRequestBody,
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  const frames = page.frames().slice(1, 6); // skip main
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    try {
      const els = (await f.evaluate(
        buildReadPageScript(8, "interactive", ""),
      )) as Array<Record<string, unknown>>;
      for (const el of els.slice(0, 40)) {
        out.push({
          ...el,
          frame_index: i + 1,
          frame_url: f.url(),
          ref: String(el.ref || "") + "@f" + (i + 1),
        });
      }
    } catch {
      /* cross-origin */
    }
  }
  if (body.frame_index != null || body.frame_url || body.frame_selector) {
    const target = await resolveFrame(page, body);
    if (target) {
      try {
        const els = (await target.evaluate(
          buildReadPageScript(12, "all", ""),
        )) as Array<Record<string, unknown>>;
        for (const el of els) {
          out.push({ ...el, frame_url: target.url(), in_target_frame: true });
        }
      } catch {
        /* ignore */
      }
    }
  }
  return out;
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
