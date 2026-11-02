// Screenshot fallback: ask a vision grounding model where a described element is in the window image.
// Works with any OpenAI-compatible vision endpoint. Default: StepFun step-gui (GUI grounding model).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

export type Shot = { path: string; x: number; y: number; w: number; h: number; px_w: number; px_h: number; error?: string };

const env = process.env;
export const VISION_MODEL = env.OCU_VISION_MODEL ?? "step-gui";

/** Shrink to a model-friendly size; returns base64 PNG and its pixel size. */
function prepare(path: string, maxSide = Number(env.OCU_VISION_MAX ?? 1280)) {
  const out = path.replace(/\.png$/, "-s.png");
  execFileSync("sips", ["-Z", String(maxSide), path, "--out", out], { stdio: "ignore" });
  const info = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", out]).toString();
  const w = Number(info.match(/pixelWidth: (\d+)/)![1]), h = Number(info.match(/pixelHeight: (\d+)/)![1]);
  return { b64: readFileSync(out).toString("base64"), w, h };
}

/** Parse the first coordinate pair from the reply: "(x,y)", "[x, y]", "<point>x y</point>", "x=.., y=..". */
export function parsePoint(text: string): [number, number] | null {
  const m = text.match(/[\[(]\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/) ?? text.match(/(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * Locate `target` in the screenshot. Returns a global screen point (top-left origin, points).
 * Coordinates from the model are read as 0-1000 relative (Qwen3-VL / UI-TARS-1.5 convention)
 * unless OCU_VISION_COORDS=pixels, in which case they are pixels of the image we sent.
 */
export async function locate(shot: Shot, target: string, model = VISION_MODEL): Promise<{ x: number; y: number; raw: string } | null> {
  const img = prepare(shot.path);
  const r = await fetch(`${env.OCU_VISION_BASE_URL ?? "https://api.stepfun.com/v1"}/chat/completions`, {
    method: "POST", signal: AbortSignal.timeout(20000),
    headers: { "content-type": "application/json", authorization: `Bearer ${env.OCU_VISION_API_KEY ?? env.STEPFUN_API_KEY}` },
    body: JSON.stringify({
      model, temperature: 0, max_tokens: 1500, // reasoning models think before answering
      messages: [{ role: "user", content: [
        { type: "image_url", image_url: { url: `data:image/png;base64,${img.b64}` } },
        { type: "text", text: `Find the UI element: "${target}". Reply with only its center point as (x,y), coordinates normalized to 0-1000 over the image width and height.` },
      ] }],
    }),
  });
  if (!r.ok) throw new Error(`vision ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const raw: string = ((await r.json()) as any).choices[0].message.content ?? ""; // final answer, not the reasoning
  const p = parsePoint(raw);
  if (!p) return null;
  const [fx, fy] = env.OCU_VISION_COORDS === "pixels" ? [p[0] / img.w, p[1] / img.h] : [p[0] / 1000, p[1] / 1000];
  return { x: shot.x + fx * shot.w, y: shot.y + fy * shot.h, raw };
}

/** Ask a vision model a question about the screenshot (for reading content the accessibility tree lacks). */
export async function ask(shot: Shot, question: string, model = env.OCU_VISION_READ_MODEL ?? "step-1o-turbo-vision"): Promise<string> {
  const img = prepare(shot.path);
  const r = await fetch(`${env.OCU_VISION_BASE_URL ?? "https://api.stepfun.com/v1"}/chat/completions`, {
    method: "POST", signal: AbortSignal.timeout(30000),
    headers: { "content-type": "application/json", authorization: `Bearer ${env.OCU_VISION_API_KEY ?? env.STEPFUN_API_KEY}` },
    body: JSON.stringify({ model, temperature: 0, max_tokens: 800, messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: `data:image/png;base64,${img.b64}` } },
      { type: "text", text: `${question}\nAnswer briefly and factually from what is visible.` },
    ] }] }),
  });
  if (!r.ok) throw new Error(`vision ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (((await r.json()) as any).choices[0].message.content ?? "").trim();
}
