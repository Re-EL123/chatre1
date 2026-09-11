/**
 * Screenshot vision captioning via Workers AI (when available).
 */
import type { Env } from "./types";

export async function captionScreenshot(
  env: Env,
  base64Jpeg: string,
  prompt?: string,
): Promise<{ ok: boolean; caption?: string; model?: string; error?: string }> {
  if (!env.AI || !base64Jpeg) {
    return { ok: false, error: "AI binding or image missing" };
  }
  const question =
    prompt ||
    "Describe this browser screenshot for an automation agent: key UI elements, visible text, buttons, inputs, and approximate positions. Be concrete and concise.";

  const bytes = base64ToBytes(base64Jpeg);

  // LLaVA-style
  try {
    const model = "@cf/llava-hf/llava-1.5-7b-hf";
    const result = (await env.AI.run(model as never, {
      prompt: question,
      image: Array.from(bytes),
    } as never)) as { description?: string; response?: string };
    const caption =
      (result && (result.description || result.response)) || "";
    if (caption) {
      return { ok: true, caption: String(caption).slice(0, 4000), model };
    }
  } catch {
    /* try next */
  }

  try {
    const model = "@cf/meta/llama-3.2-11b-vision-instruct";
    const result = (await env.AI.run(model as never, {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: question },
            {
              type: "image_url",
              image_url: {
                url: "data:image/jpeg;base64," + base64Jpeg,
              },
            },
          ],
        },
      ],
      max_tokens: 512,
    } as never)) as { response?: string };
    if (result && result.response) {
      return {
        ok: true,
        caption: String(result.response).slice(0, 4000),
        model,
      };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return { ok: false, error: "Vision models unavailable" };
}

function base64ToBytes(b64: string): Uint8Array {
  const normalized = b64.replace(/^data:image\/\w+;base64,/, "");
  const binary = atob(normalized);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
