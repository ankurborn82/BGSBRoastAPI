// Gemini 2.5 models support disabling thinking via:
//   generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
// Setting thinkingBudget: 0 eliminates thinking tokens, reducing latency significantly.
// Recommended to add once confirmed against the deployed model version.

export default async function handler(req, res) {
  // CORS — allow requests from any origin (your app uses fetch directly)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-token');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Simple token check to prevent unauthorized use of your Gemini quota
  const appToken = req.headers['x-app-token'];
  if (!appToken || appToken !== process.env.APP_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { prompt, imageBase64, mimeType } = req.body;
  if (!prompt || !imageBase64) {
    return res.status(400).json({ error: 'Missing prompt or image data' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  try {
    // Abort 5 s before Vercel's hard 30 s maxDuration so we can return clean JSON
    // instead of letting Vercel serve an HTML 504 page to the app.
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } }
            ]
          }]
        })
      }
    );

    const data = await geminiRes.json();
    if (data.error) return res.status(502).json({ error: data.error.message });

    // Gemini 2.5 models return thinking tokens as parts with { thought: true }.
    // The actual model response is in the last non-thought text part.
    const parts = data.candidates?.[0]?.content?.parts || [];
    if (process.env.NODE_ENV !== 'production') {
      console.log('[analyze] Gemini parts shape:', parts.map(p => ({ thought: !!p.thought, chars: p.text?.length ?? 0 })));
    }
    const responsePart = parts.filter(p => !p.thought && typeof p.text === 'string').pop();
    const text = responsePart?.text ?? '';

    if (!text) return res.status(502).json({ error: 'Gemini returned an empty response. Please try again.' });
    return res.status(200).json({ text });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return res.status(504).json({ error: 'Analysis timed out — Gemini took too long. Please try again.' });
    }
    return res.status(502).json({ error: err.message || 'Failed to reach Gemini' });
  }
}
