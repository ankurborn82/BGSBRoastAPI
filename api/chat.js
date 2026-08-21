import { MODELS } from './_lib/gemini.js';
import { isAuthorized } from './_lib/auth.js';
import { answerWithKnowledgeBase } from './_lib/rag.js';

// Roast Timer app chat (authenticated). RAG over the BGSB knowledge base.
export const CHAT_MAX_OUTPUT_TOKENS = 1024;
export const CHAT_MAX_MESSAGE_CHARS = 2000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!isAuthorized(req.headers['x-app-token'])) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { message, history = [] } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'message is required' });
  if (message.trim().length > CHAT_MAX_MESSAGE_CHARS) return res.status(400).json({ error: 'Message too long' });

  try {
    const text = await answerWithKnowledgeBase({
      message, history,
      model: MODELS.chat,
      maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
      thinkingBudget: 0, // gemini-3.5-flash: skip thinking for latency/quota
    });
    return res.status(200).json({ text });
  } catch (err) {
    console.error('Chat error:', err.message);
    const status = err.message === 'Server not configured' ? 500 : 502;
    return res.status(status).json({ error: err.message || 'Chat failed' });
  }
}
