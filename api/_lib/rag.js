import { MODELS, geminiPost, responseText, upstreamErrorMessage } from './gemini.js';

const SYSTEM_PROMPT_HEAD = `You are a knowledgeable coffee expert for Big Guy Small Batch Coffee Roasters (BGSB).
You specialise in home coffee roasting, green bean selection, roast profiles, first crack timing, development time ratio (DTR), and brewing techniques.
Be concise, practical, and warm. Use the knowledge base excerpts below to ground your answers.
If the excerpts don't cover the question, draw on your general coffee expertise and say so.
Never make up specific facts like temperatures or times — only state those if they appear in the excerpts.

KNOWLEDGE BASE:
`;

/**
 * Shared RAG pipeline for /api/chat and /api/webchat:
 * embed question → Pinecone top-5 → grounded Gemini answer.
 * Throws Error with a client-safe message on failure.
 */
export async function answerWithKnowledgeBase({ message, history = [], model, maxOutputTokens, thinkingBudget, env = process.env, fetchImpl = fetch }) {
  const apiKey = env.GEMINI_API_KEY;
  const pineconeKey = env.PINECONE_API_KEY;
  const pineconeHost = env.PINECONE_INDEX_HOST;
  if (!apiKey || !pineconeKey || !pineconeHost) throw new Error('Server not configured');

  // Step 1: embed the question
  const embed = await geminiPost({
    apiKey, model: MODELS.embed, method: 'embedContent', fetchImpl,
    body: { model: `models/${MODELS.embed}`, content: { parts: [{ text: message }] }, taskType: 'RETRIEVAL_QUERY' },
  });
  if (!embed.ok || !embed.data?.embedding?.values) {
    throw new Error(`Embedding failed: ${upstreamErrorMessage(embed.data, 'upstream error')}`);
  }

  // Step 2: Pinecone
  const pineconeRes = await fetchImpl(`${pineconeHost}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Api-Key': pineconeKey },
    body: JSON.stringify({ vector: embed.data.embedding.values, topK: 5, includeMetadata: true }),
  });
  if (!pineconeRes.ok) throw new Error('Knowledge base query failed');
  const pineconeData = await pineconeRes.json();

  // Step 3: context
  const context = (pineconeData.matches || [])
    .filter(m => m.score > 0.5)
    .map(m => `[${m.metadata.source}]\n${m.metadata.text}`)
    .join('\n\n---\n\n');

  // Step 4: conversation (last 6 turns)
  const recentHistory = Array.isArray(history) ? history.slice(-6) : [];
  const contents = [
    { role: 'user',  parts: [{ text: SYSTEM_PROMPT_HEAD + (context || 'No relevant excerpts found — answer from general coffee expertise.') }] },
    { role: 'model', parts: [{ text: 'Understood. I am ready to help with coffee roasting questions.' }] },
    ...recentHistory.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: String(m.text ?? '') }] })),
    { role: 'user', parts: [{ text: message }] },
  ];

  // Step 5: answer. Output is always bounded.
  const generationConfig = { maxOutputTokens };
  if (typeof thinkingBudget === 'number') generationConfig.thinkingConfig = { thinkingBudget };
  const gen = await geminiPost({ apiKey, model, method: 'generateContent', fetchImpl, body: { contents, generationConfig } });
  if (!gen.ok || gen.data?.error) throw new Error(`Gemini failed: ${upstreamErrorMessage(gen.data, 'upstream error')}`);
  const answer = responseText(gen.data);
  if (!answer) throw new Error('Empty response from Gemini');
  return answer;
}
