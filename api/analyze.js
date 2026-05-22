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
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return res.status(200).json({ text });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Failed to reach Gemini' });
  }
}
