export function makeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined, ended: false };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; res.ended = true; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}
export function makeReq({ method = 'POST', headers = {}, body = {} } = {}) {
  return { method, headers, body };
}
/** Mock fetch that records calls and returns queued responses in order. */
export function mockFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error('mockFetch: no response queued for ' + url);
    const { status = 200, json } = next;
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  fn.calls = calls;
  return fn;
}
export const FAKE_ENV = {
  GEMINI_API_KEY: 'test-gemini-key-not-real',
  APP_TOKEN: 'old-token-test-value',
  APP_TOKEN_NEXT: 'next-token-test-value',
  PINECONE_API_KEY: 'test-pinecone-key',
  PINECONE_INDEX_HOST: 'https://pinecone.test',
};
export function withEnv(env, fn) {
  const saved = {};
  for (const k of ['GEMINI_API_KEY','APP_TOKEN','APP_TOKEN_NEXT','PINECONE_API_KEY','PINECONE_INDEX_HOST']) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, env);
  return Promise.resolve().then(fn).finally(() => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
}
export const GEN_OK = (text) => ({ status: 200, json: { candidates: [{ content: { parts: [{ text }] } }] } });
export const EMBED_OK = { status: 200, json: { embedding: { values: [0.1, 0.2] } } };
export const PINECONE_OK = { status: 200, json: { matches: [{ score: 0.9, metadata: { source: 'doc', text: 'First crack is ...' } }] } };
