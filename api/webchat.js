const ALLOWED_ORIGINS = [
  'https://roastcoffee.ai',
  'https://www.roastcoffee.ai',
];

export default async function handler(req, res) {
  const origin = req.headers['origin'] || '';
  const isAllowed = ALLOWED_ORIGINS.some(o => origin === o) ||
    origin.endsWith('.vercel.app');

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!isAllowed) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { message, history = [] } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message is required' });
  if (message.trim().length > 600) return res.status(400).json({ error: 'Message too long' });

  const GEMINI_KEY    = process.env.GEMINI_API_KEY;
  const PINECONE_KEY  = process.env.PINECONE_API_KEY;
  const PINECONE_HOST = process.env.PINECONE_INDEX_HOST;

  try {
    // Step 1: Embed the question
    const embedRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:    'models/gemini-embedding-001',
          content:  { parts: [{ text: message }] },
          taskType: 'RETRIEVAL_QUERY',
        }),
      }
    );
    if (!embedRes.ok) {
      const err = await embedRes.json();
      throw new Error(`Embedding failed: ${JSON.stringify(err)}`);
    }
    const queryVector = (await embedRes.json()).embedding.values;

    // Step 2: Search Pinecone
    const pineconeRes = await fetch(`${PINECONE_HOST}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Api-Key': PINECONE_KEY },
      body: JSON.stringify({ vector: queryVector, topK: 5, includeMetadata: true }),
    });
    if (!pineconeRes.ok) {
      const err = await pineconeRes.json();
      throw new Error(`Pinecone query failed: ${JSON.stringify(err)}`);
    }
    const pineconeData = await pineconeRes.json();

    // Step 3: Build context
    const context = (pineconeData.matches || [])
      .filter(m => m.score > 0.5)
      .map(m => `[${m.metadata.source}]\n${m.metadata.text}`)
      .join('\n\n---\n\n');

    // Step 4: Build conversation
    const systemPrompt = `You are a knowledgeable coffee expert for Big Guy Small Batch Coffee Roasters (BGSB).
You specialise in home coffee roasting, green bean selection, roast profiles, first crack timing, development time ratio (DTR), and brewing techniques.
Be concise, practical, and warm. Use the knowledge base excerpts below to ground your answers.
If the excerpts don't cover the question, draw on your general coffee expertise and say so.
Never make up specific facts like temperatures or times — only state those if they appear in the excerpts.

KNOWLEDGE BASE:
${context || 'No relevant excerpts found — answer from general coffee expertise.'}`;

    const recentHistory = history.slice(-6);
    const contents = [
      { role: 'user',  parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Understood. I am ready to help with coffee roasting questions.' }] },
      ...recentHistory.map(m => ({
        role:  m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }],
      })),
      { role: 'user', parts: [{ text: message }] },
    ];

    // Step 5: Generate answer
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents }),
      }
    );
    if (!geminiRes.ok) {
      const err = await geminiRes.json();
      throw new Error(`Gemini failed: ${JSON.stringify(err)}`);
    }
    const geminiData = await geminiRes.json();
    const answer = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!answer) throw new Error('Empty response from Gemini');

    return res.status(200).json({ text: answer });

  } catch (err) {
    console.error('Webchat error:', err.message);
    return res.status(500).json({ error: err.message || 'Chat failed' });
  }
}
