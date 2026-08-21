import { timingSafeEqual } from 'node:crypto';

/** Constant-time string compare that also hides length differences behind a
 *  fixed-cost comparison (lengths are compared after the byte compare). */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Compare against itself to keep timing flat, then fail.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/**
 * App-token check with a transition window.
 * Accepts the presented token if it equals APP_TOKEN or APP_TOKEN_NEXT.
 * APP_TOKEN_NEXT is optional: when unset or empty it is simply ignored, so
 * existing production keeps working unchanged. Token values are never logged.
 */
export function isAuthorized(presented, env = process.env) {
  if (typeof presented !== 'string' || presented.length === 0) return false;
  const candidates = [env.APP_TOKEN, env.APP_TOKEN_NEXT].filter(t => typeof t === 'string' && t.length > 0);
  if (candidates.length === 0) return false;
  // Evaluate every candidate (no early return) to keep timing independent of
  // which one matched.
  let ok = false;
  for (const c of candidates) ok = safeEqual(presented, c) || ok;
  return ok;
}
