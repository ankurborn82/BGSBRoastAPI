import { test } from 'node:test';
import assert from 'node:assert/strict';
import analyze, { ANALYZE_MAX_OUTPUT_TOKENS } from '../api/analyze.js';
import chat from '../api/chat.js';
import webchat, { ALLOWED_ORIGINS, WEBCHAT_MAX_OUTPUT_TOKENS, WEBCHAT_MAX_MESSAGE_CHARS } from '../api/webchat.js';
import { MODELS } from '../api/_lib/gemini.js';
import { makeReq, makeRes, mockFetch, withEnv, FAKE_ENV, GEN_OK, EMBED_OK, PINECONE_OK } from './_helpers.mjs';

function assertHeaderTransport(call) {
  assert.ok(!call.url.includes('key='), 'API key must not be in the URL: ' + call.url);
  assert.ok(!call.url.includes(FAKE_ENV.GEMINI_API_KEY), 'API key value must not be in the URL');
  assert.equal(call.init.headers['x-goog-api-key'], FAKE_ENV.GEMINI_API_KEY);
}

test('models pinned to 3.x (gemini-bgsb cannot use 2.5)', () => {
  for (const m of [MODELS.analyze, MODELS.chat, MODELS.webchat]) assert.match(m, /^gemini-3\./);
  assert.equal(MODELS.embed, 'gemini-embedding-001');
});

test('analyze: 401 without token, 401 with wrong token', () => withEnv(FAKE_ENV, async () => {
  let res = makeRes(); await analyze(makeReq({ body: { prompt: 'p', imageBase64: 'x' } }), res); assert.equal(res.statusCode, 401);
  res = makeRes(); await analyze(makeReq({ headers: { 'x-app-token': 'wrong' }, body: { prompt: 'p', imageBase64: 'x' } }), res); assert.equal(res.statusCode, 401);
}));

test('analyze: old token works, header key transport, 3.5-flash-lite, bounded output', () => withEnv(FAKE_ENV, async () => {
  const f = mockFetch([GEN_OK('Roast looks even.')]); const orig = globalThis.fetch; globalThis.fetch = f;
  try {
    const res = makeRes();
    await analyze(makeReq({ headers: { 'x-app-token': FAKE_ENV.APP_TOKEN }, body: { prompt: 'p', imageBase64: 'AAAA', mimeType: 'image/jpeg' } }), res);
    assert.equal(res.statusCode, 200); assert.equal(res.body.text, 'Roast looks even.');
    assert.equal(f.calls.length, 1); assertHeaderTransport(f.calls[0]);
    assert.ok(f.calls[0].url.includes(`/models/${MODELS.analyze}:generateContent`));
    const body = JSON.parse(f.calls[0].init.body);
    assert.equal(body.generationConfig.maxOutputTokens, ANALYZE_MAX_OUTPUT_TOKENS);
    assert.equal(body.contents[0].parts[1].inline_data.mime_type, 'image/jpeg');
  } finally { globalThis.fetch = orig; }
}));

test('analyze: NEXT token works; upstream error -> 502 without leaking', () => withEnv(FAKE_ENV, async () => {
  const f = mockFetch([{ status: 404, json: { error: { message: 'model not found' } } }]); const orig = globalThis.fetch; globalThis.fetch = f;
  try {
    const res = makeRes();
    await analyze(makeReq({ headers: { 'x-app-token': FAKE_ENV.APP_TOKEN_NEXT }, body: { prompt: 'p', imageBase64: 'AAAA' } }), res);
    assert.equal(res.statusCode, 502); assert.equal(res.body.error, 'model not found');
  } finally { globalThis.fetch = orig; }
}));

test('chat: full RAG path with old token; 3.5-flash + thinkingBudget 0; header transport on both Gemini calls', () => withEnv(FAKE_ENV, async () => {
  const f = mockFetch([EMBED_OK, PINECONE_OK, GEN_OK('Answer.')]); const orig = globalThis.fetch; globalThis.fetch = f;
  try {
    const res = makeRes();
    await chat(makeReq({ headers: { 'x-app-token': FAKE_ENV.APP_TOKEN }, body: { message: 'what is first crack?', history: [{ role: 'user', text: 'hi' }] } }), res);
    assert.equal(res.statusCode, 200); assert.equal(res.body.text, 'Answer.');
    assert.equal(f.calls.length, 3);
    assertHeaderTransport(f.calls[0]); assert.ok(f.calls[0].url.includes('gemini-embedding-001:embedContent'));
    assert.equal(f.calls[1].url, FAKE_ENV.PINECONE_INDEX_HOST + '/query'); assert.equal(f.calls[1].init.headers['Api-Key'], FAKE_ENV.PINECONE_API_KEY);
    assertHeaderTransport(f.calls[2]); assert.ok(f.calls[2].url.includes(`/models/${MODELS.chat}:generateContent`));
    const body = JSON.parse(f.calls[2].init.body);
    assert.equal(body.generationConfig.maxOutputTokens, 1024); assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 0);
    assert.ok(body.contents[0].parts[0].text.includes('First crack is ...'), 'context grounded');
  } finally { globalThis.fetch = orig; }
}));

test('chat: 401 without token; NEXT token accepted', () => withEnv(FAKE_ENV, async () => {
  let res = makeRes(); await chat(makeReq({ body: { message: 'x' } }), res); assert.equal(res.statusCode, 401);
  const f = mockFetch([EMBED_OK, PINECONE_OK, GEN_OK('ok')]); const orig = globalThis.fetch; globalThis.fetch = f;
  try { res = makeRes(); await chat(makeReq({ headers: { 'x-app-token': FAKE_ENV.APP_TOKEN_NEXT }, body: { message: 'x' } }), res); assert.equal(res.statusCode, 200); }
  finally { globalThis.fetch = orig; }
}));

test('webchat: CORS allowlist is exact — no *.vercel.app wildcard', () => withEnv(FAKE_ENV, async () => {
  assert.deepEqual([...ALLOWED_ORIGINS], ['https://roastcoffee.ai', 'https://www.roastcoffee.ai', 'https://bgsb-roast-api.vercel.app']);
  for (const bad of ['https://evil.vercel.app', 'https://bgsb-roast-api.vercel.app.evil.com', 'http://roastcoffee.ai', '', undefined]) {
    const res = makeRes(); await webchat(makeReq({ headers: { origin: bad }, body: { message: 'hi' } }), res);
    assert.equal(res.statusCode, 403, 'origin should be rejected: ' + bad);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  }
  const pre = makeRes(); await webchat(makeReq({ method: 'OPTIONS', headers: { origin: 'https://evil.vercel.app' } }), pre); assert.equal(pre.statusCode, 403);
}));

test('webchat: allowed origins work; flash-lite; bounded output; header transport; friendly error', () => withEnv(FAKE_ENV, async () => {
  for (const good of ALLOWED_ORIGINS) {
    const f = mockFetch([EMBED_OK, PINECONE_OK, GEN_OK('Short answer.')]); const orig = globalThis.fetch; globalThis.fetch = f;
    try {
      const res = makeRes(); await webchat(makeReq({ headers: { origin: good }, body: { message: 'hi' } }), res);
      assert.equal(res.statusCode, 200, good); assert.equal(res.headers['access-control-allow-origin'], good); assert.equal(res.headers['vary'], 'Origin');
      assertHeaderTransport(f.calls[2]); assert.ok(f.calls[2].url.includes(`/models/${MODELS.webchat}:generateContent`));
      const body = JSON.parse(f.calls[2].init.body);
      assert.equal(body.generationConfig.maxOutputTokens, WEBCHAT_MAX_OUTPUT_TOKENS); assert.equal(body.generationConfig.thinkingConfig, undefined);
    } finally { globalThis.fetch = orig; }
  }
  // input cap preserved
  let res = makeRes(); await webchat(makeReq({ headers: { origin: ALLOWED_ORIGINS[0] }, body: { message: 'x'.repeat(WEBCHAT_MAX_MESSAGE_CHARS + 1) } }), res); assert.equal(res.statusCode, 400);
  // upstream failure -> generic message, no upstream details
  const f = mockFetch([{ status: 429, json: { error: { message: 'quota exceeded for project 12345' } } }]); const orig = globalThis.fetch; globalThis.fetch = f;
  try { res = makeRes(); await webchat(makeReq({ headers: { origin: ALLOWED_ORIGINS[0] }, body: { message: 'hi' } }), res); assert.equal(res.statusCode, 502); assert.ok(!res.body.error.includes('12345')); }
  finally { globalThis.fetch = orig; }
}));

test('no route has a configured-key fallback path that sends ?key=', async () => {
  const fs = await import('node:fs'); 
  for (const f of ['api/analyze.js', 'api/chat.js', 'api/webchat.js', 'api/_lib/gemini.js', 'api/_lib/rag.js']) {
    const src = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.ok(!/[?&]key=/.test(src), f + ' must not build ?key= URLs');
    assert.ok(!/gemini-2\.5/.test(src), f + ' must not reference gemini-2.5 models');
  }
});
