import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorized, safeEqual } from '../api/_lib/auth.js';

test('safeEqual basics', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual(undefined, 'abc'), false);
});
test('accepts APP_TOKEN', () => assert.equal(isAuthorized('old', { APP_TOKEN: 'old' }), true));
test('accepts APP_TOKEN_NEXT when set', () => assert.equal(isAuthorized('next', { APP_TOKEN: 'old', APP_TOKEN_NEXT: 'next' }), true));
test('old token still works while NEXT is set', () => assert.equal(isAuthorized('old', { APP_TOKEN: 'old', APP_TOKEN_NEXT: 'next' }), true));
test('NEXT unset or empty is ignored, does not break', () => {
  assert.equal(isAuthorized('old', { APP_TOKEN: 'old' }), true);
  assert.equal(isAuthorized('old', { APP_TOKEN: 'old', APP_TOKEN_NEXT: '' }), true);
  assert.equal(isAuthorized('', { APP_TOKEN: 'old', APP_TOKEN_NEXT: '' }), false);
});
test('rejects wrong / missing / no configured tokens', () => {
  assert.equal(isAuthorized('nope', { APP_TOKEN: 'old', APP_TOKEN_NEXT: 'next' }), false);
  assert.equal(isAuthorized(undefined, { APP_TOKEN: 'old' }), false);
  assert.equal(isAuthorized('old', {}), false);
  assert.equal(isAuthorized('', { APP_TOKEN: '' }), false);
});
