import { MODELS } from './_lib/gemini.js';
import { answerWithKnowledgeBase } from './_lib/rag.js';

// Public website widget (no app token). Served from public/roast-bot.html on this
// deployment and embedded on roastcoffee.ai via an iframe, so the widget's own
// fetch Origin is this deployment's production hostname — listed explicitly below.
// No wildcard origins: preview deployments of the widget are intentionally not allowed.
export const ALLOWED_ORIGINS = Object.freeze([
  'https://roastcoffee.ai',
  'https://www.roastcoffee.ai',
  'https://bgsb-roast-api.vercel.app',
]);
export const WEBCHAT_MAX_MESSAGE_CHARS = 600;   // matches the widget's maxlength
export const WEBCHAT_MAX_OUTPUT_TOKENS = 768;    // public traffic: keep answers short

export function isAllowedOrigin(origin) {
  return typeof origin === 'string' && ALLOWED_ORIGINS.includes(origin);
}

export default async function handler(req, res) {
  const origin = req.headers['origin'] || '';
  const allowed = isAllowedOrigin(origin);

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  if (allowed) res.setHeader('Access-Control-Allow-Origin', origin);

  if (req.method === 'OPTIONS') return res.status(allowed ? 200 : 403).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });

  const { message, history = [] } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'message is required' });
  if (message.trim().length > WEBCHAT_MAX_MESSAGE_CHARS) return res.status(400).json({ error: 'Message too long' });

  try {
    const text = await answerWithKnowledgeBase({
      message, history,
      model: MODELS.webchat,
      maxOutputTokens: WEBCHAT_MAX_OUTPUT_TOKENS,
    });
    return res.status(200).json({ text });
  } catch (err) {
    console.error('Webchat error:', err.message);
    const status = err.message === 'Server not configured' ? 500 : 502;
    return res.status(status).json({ error: 'The roast bot is unavailable right now. Please try again later.' });
  }
}
