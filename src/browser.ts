/**
 * Browser automation via Cloudflare Browser Rendering + Puppeteer.
 */
import type { Browser, Page } from "@cloudflare/puppeteer";
import puppeteer from "@cloudflare/puppeteer";
import type { Env } from "./types";

export type BrowserAction =
  | "navigate"
  | "click"
  | "type"
  | "press"
  | "screenshot"
  | "content"
  | "evaluate"
  | "wait"
  | "scroll"
  | "tabs";

export interface BrowserRequestBody {
  action?: BrowserAction;
  url?: string;
  selector?: string;
  text?: string;
  key?: string;
  script?: string;
  ms?: number;
  fullPage?: boolean;
  x?: number;
  y?: number;
  /** Optional prior cookies for continuity */
  cookies?: Array<Record<string, unknown>>;
}

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, x-chatre-key",
      ...extraHeaders,
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

  const action = (body.action || "navigate") as BrowserAction;
  let browser: Browser | null = null;

  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    if (Array.isArray(body.cookies) && body.cookies.length) {
      try {
        await page.setCookie(...(body.cookies as never[]));
      } catch {
        /* ignore bad cookies */
      }
    }

    // Each Worker invocation starts a fresh browser; reopen URL when provided.
    if (action !== "navigate" && body.url) {
      await page.goto(String(body.url).trim(), {
        waitUntil: "networkidle2",
        timeout: 45000,
      });
    }

    const result = await runAction(page, action, body);
    let cookies: unknown[] = [];
    try {
      cookies = await page.cookies();
    } catch {
      cookies = [];
    }

    await browser.close();
    browser = null;

    return jsonResponse({
      ok: true,
      action,
      ...result,
      cookies,
    });
  } catch (err) {
    try {
      if (browser) await browser.close();
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

async function runAction(
  page: Page,
  action: BrowserAction,
  body: BrowserRequestBody,
): Promise<Record<string, unknown>> {
  switch (action) {
    case "navigate": {
      const url = String(body.url || "").trim();
      if (!url) throw new Error("url required");
      await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
      return await snapshot(page, body.fullPage !== false);
    }
    case "click": {
      if (!body.selector) throw new Error("selector required");
      await page.waitForSelector(body.selector, { timeout: 15000 });
      await page.click(body.selector);
      await sleep(400);
      return await snapshot(page, false);
    }
    case "type": {
      if (!body.selector) throw new Error("selector required");
      await page.waitForSelector(body.selector, { timeout: 15000 });
      await page.click(body.selector, { clickCount: 3 }).catch(() => undefined);
      await page.type(body.selector, String(body.text || ""), { delay: 20 });
      return await snapshot(page, false);
    }
    case "press": {
      const key = String(body.key || "Enter");
      await page.keyboard.press(key as never);
      await sleep(300);
      return await snapshot(page, false);
    }
    case "screenshot": {
      return await snapshot(page, body.fullPage === true);
    }
    case "content": {
      const text = await page.evaluate(
        "document.body ? document.body.innerText : ''",
      );
      const html = await page.content();
      return {
        url: page.url(),
        title: await page.title(),
        text: String(text).slice(0, 50000),
        html: String(html).slice(0, 80000),
      };
    }
    case "evaluate": {
      const script = String(body.script || "");
      if (!script) throw new Error("script required");
      const value = await page.evaluate(
        "new Function(" + JSON.stringify(script) + ")()",
      );
      const snap = await snapshot(page, false);
      return {
        ...snap,
        result: value,
      };
    }
    case "wait": {
      const ms = Math.min(Math.max(Number(body.ms) || 1000, 100), 20000);
      if (body.selector) {
        await page.waitForSelector(body.selector, { timeout: ms });
      } else {
        await sleep(ms);
      }
      return await snapshot(page, false);
    }
    case "scroll": {
      const y = Number(body.y) || 800;
      await page.evaluate("window.scrollBy(0, " + Number(y) + ")");
      await sleep(300);
      return await snapshot(page, false);
    }
    case "tabs": {
      return {
        url: page.url(),
        title: await page.title(),
        tabs: [{ url: page.url(), title: await page.title(), active: true }],
      };
    }
    default:
      throw new Error("Unknown browser action: " + action);
  }
}

async function snapshot(page: Page, fullPage: boolean) {
  const text = await page.evaluate(
    "document.body ? document.body.innerText : ''",
  );
  const screenshot = await page.screenshot({
    encoding: "base64",
    fullPage: !!fullPage,
    type: "jpeg",
    quality: 55,
  });
  const links = await page.evaluate(`(() => {
    return Array.from(document.querySelectorAll("a[href]"))
      .slice(0, 40)
      .map((a) => ({
        text: (a.textContent || "").trim().slice(0, 80),
        href: a.href,
      }))
      .filter((l) => l.href);
  })()`);
  const inputs = await page.evaluate(`(() => {
    function esc(s) {
      try { return CSS.escape(s); } catch (e) {
        return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
      }
    }
    return Array.from(
      document.querySelectorAll("input, textarea, button, [role='button']"),
    )
      .slice(0, 40)
      .map((el, i) => {
        const e = el;
        return {
          index: i,
          tag: e.tagName.toLowerCase(),
          type: e.type || "",
          name: e.name || "",
          id: e.id || "",
          placeholder: e.placeholder || "",
          text: (e.textContent || "").trim().slice(0, 60),
          selector: e.id
            ? "#" + esc(e.id)
            : e.tagName.toLowerCase() +
              (e.className && typeof e.className === "string"
                ? "." +
                  e.className
                    .trim()
                    .split(/\\s+/)
                    .slice(0, 2)
                    .map(esc)
                    .join(".")
                : ""),
        };
      });
  })()`);

  return {
    url: page.url(),
    title: await page.title(),
    text: String(text).slice(0, 20000),
    screenshot_base64: screenshot,
    mime: "image/jpeg",
    links,
    inputs,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
