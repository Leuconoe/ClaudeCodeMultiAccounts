const test = require('node:test');
const assert = require('node:assert');
const { assessCredentials, verifyLiveIdentity, ACCESS_TOKEN_SAFETY_MS } = require('../lib/auth/guard.cjs');
const { getAccountKey } = require('../lib/store/accounts.cjs');

const NOW = 1_800_000_000_000;

function validOauth(overrides = {}) {
  return {
    accessToken: 'access-token-fixture',
    refreshToken: 'refresh-token-fixture',
    expiresAt: NOW + 60 * 60 * 1000,
    refreshTokenExpiresAt: NOW + 30 * 24 * 60 * 60 * 1000,
    scopes: ['user:inference'],
    subscriptionType: 'pro',
    rateLimitTier: 'default_claude',
    ...overrides,
  };
}

test('assessCredentials: valid access token -> ok', () => {
  assert.strictEqual(assessCredentials(validOauth(), NOW).verdict, 'ok');
});

test('assessCredentials: expired access token -> need-refresh', () => {
  const result = assessCredentials(validOauth({ expiresAt: NOW - 1000 }), NOW);
  assert.strictEqual(result.verdict, 'need-refresh');
});

test('assessCredentials: access token expiring inside safety margin -> need-refresh', () => {
  const result = assessCredentials(validOauth({ expiresAt: NOW + ACCESS_TOKEN_SAFETY_MS - 1 }), NOW);
  assert.strictEqual(result.verdict, 'need-refresh');
});

test('assessCredentials: missing/invalid expiresAt -> need-refresh (conservative)', () => {
  assert.strictEqual(assessCredentials(validOauth({ expiresAt: undefined }), NOW).verdict, 'need-refresh');
  assert.strictEqual(assessCredentials(validOauth({ expiresAt: 'not-a-number' }), NOW).verdict, 'need-refresh');
});

test('assessCredentials: expired refresh token -> refresh-expired', () => {
  const result = assessCredentials(validOauth({ refreshTokenExpiresAt: NOW - 1000 }), NOW);
  assert.strictEqual(result.verdict, 'refresh-expired');
});

test('assessCredentials: missing refresh token -> refresh-expired', () => {
  assert.strictEqual(assessCredentials(validOauth({ refreshToken: undefined }), NOW).verdict, 'refresh-expired');
});

test('assessCredentials: missing claudeAiOauth -> refresh-expired', () => {
  assert.strictEqual(assessCredentials(undefined, NOW).verdict, 'refresh-expired');
});

test('verifyLiveIdentity: clean live state -> ok', () => {
  const config = { oauthAccount: { accountUuid: 'uuid-a', emailAddress: 'a@test.com' } };
  const credentials = { claudeAiOauth: validOauth() };
  const store = { accounts: [] };
  assert.strictEqual(verifyLiveIdentity(config, credentials, store, getAccountKey).ok, true);
});

test('verifyLiveIdentity: live tokens matching own slot -> ok', () => {
  const config = { oauthAccount: { accountUuid: 'uuid-a', emailAddress: 'a@test.com' } };
  const credentials = { claudeAiOauth: validOauth() };
  const store = {
    accounts: [{ key: 'uuid:uuid-a', credentials: { claudeAiOauth: validOauth() } }],
  };
  assert.strictEqual(verifyLiveIdentity(config, credentials, store, getAccountKey).ok, true);
});

test('verifyLiveIdentity: live tokens matching a DIFFERENT slot -> rejected (poisoning)', () => {
  const config = { oauthAccount: { accountUuid: 'uuid-b', emailAddress: 'b@test.com' } };
  const credentials = { claudeAiOauth: validOauth() };
  const store = {
    accounts: [{ key: 'uuid:uuid-a', credentials: { claudeAiOauth: validOauth() } }],
  };
  const result = verifyLiveIdentity(config, credentials, store, getAccountKey);
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /different account/);
});

test('verifyLiveIdentity: unusable live tokens -> rejected', () => {
  const config = { oauthAccount: { accountUuid: 'uuid-a' } };
  const result = verifyLiveIdentity(config, { claudeAiOauth: { accessToken: 'x' } }, { accounts: [] }, getAccountKey);
  assert.strictEqual(result.ok, false);
});
