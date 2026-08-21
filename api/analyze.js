import { MODELS, geminiPost, responseText, upstreamErrorMessage } from './_lib/gemini.js';
import { isAuthorized } from './_lib/auth.js';

// Roast Timer app → image + prompt → analysis text.
// Authenticated with the app token (APP_TOKEN / APP_TOKEN_NEXT transition window).
export const ANALYZE_MAX_OUTPUT_TOKENS = 2048;

export default async function handler(req, res) {
  // CORS — the mobile app calls this directly; no browser origin involved.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-token');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!isAuthorized(req.headers['x-app-token'])) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { prompt, imageBase64, mimeType } = req.body || {};
  if (!prompt || !imageBase64) {
    return res.status(400).json({ error: 'Missing prompt or image data' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server not configured' });

  try {
    // Abort 5 s before Vercel's hard 30 s maxDuration so we return clean JSON
    // instead of letting Vercel serve an HTML 504 page to the app.
    const { ok, data } = await geminiPost({
      apiKey,
      model: MODELS.analyze,
      method: 'generateContent',
      signal: AbortSignal.timeout(25000),
      body: {
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } },
          ],
        }],
        generationConfig: { maxOutputTokens: ANALYZE_MAX_OUTPUT_TOKENS },
      },
    });

    if (!ok || data?.error) {
      return res.status(502).json({ error: upstreamErrorMessage(data, 'Analysis service error') });
    }
    const text = responseText(data);
    if (!text) return res.status(502).json({ error: 'Gemini returned an empty response. Please try again.' });
    return res.status(200).json({ text });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return res.status(504).json({ error: 'Analysis timed out — Gemini took too long. Please try again.' });
    }
    return res.status(502).json({ error: 'Failed to reach Gemini' });
  }
}
