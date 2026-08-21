// Gemini REST helpers for the RoastAPI routes.
//
// Key transport: the API key is sent ONLY in the `x-goog-api-key` request header,
// never in the URL query string, so it cannot leak through request logs, error
// pages, or proxies that record URLs.
//
// Models: this API runs in the `gemini-bgsb` Google project (created 2026-08-21).
// New projects cannot use the older 2.5 model family ("no longer available to new
// users"), so every route pins a 3.x model. Keep the lighter model wherever the
// task allows — the project is on the Free Tier by design.

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const MODELS = Object.freeze({
  analyze: 'gemini-3.5-flash-lite',   // image + prompt; latency-bound (25 s budget)
  chat:    'gemini-3.5-flash',        // authenticated app users; a little more quality
  webchat: 'gemini-3.5-flash-lite',   // public widget; lowest quota cost
  embed:   'gemini-embedding-001',
});

export function geminiUrl(model, method) {
  return `${BASE}/${model}:${method}`;
}

export function geminiHeaders(apiKey) {
  return { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
}

/** POST to a Gemini model method. Returns the parsed JSON body; the caller
 *  inspects `ok` / `data.error`. `signal` is optional (AbortSignal). */
export async function geminiPost({ apiKey, model, method, body, signal, fetchImpl = fetch }) {
  const res = await fetchImpl(geminiUrl(model, method), {
    method: 'POST',
    headers: geminiHeaders(apiKey),
    signal,
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

/** Extract the first non-thought text part of a generateContent response. */
export function responseText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const part = parts.filter(p => !p.thought && typeof p.text === 'string').pop();
  return part?.text ?? '';
}

/** Never echo upstream error bodies verbatim to clients: they can include
 *  request details. Keep the message, drop the rest. */
export function upstreamErrorMessage(data, fallback) {
  const msg = data?.error?.message;
  return typeof msg === 'string' && msg.length <= 300 ? msg : fallback;
}
