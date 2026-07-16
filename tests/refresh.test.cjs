const test = require('node:test');
const assert = require('node:assert');
const { refreshTokens, mergeRefreshedTokens, OAUTH_CLIENT_ID } = require('../lib/auth/refresh.cjs');

const NOW = 1_800_000_000_000;

function storedOauth() {
  return {
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    expiresAt: NOW - 1000,
    refreshTokenExpiresAt: NOW + 999999,
    scopes: ['user:inference', 'user:profile'],
    subscriptionType: 'max',
    rateLimitTier: 'default_claude_max_5x',
  };
}

test('refreshTokens: 200 -> merged tokens, preserved metadata fields', async () => {
  const calls = [];
  const result = await refreshTokens(storedOauth(), {
    now: () => NOW,
    httpPost: async (endpoint, body) => {
      calls.push({ endpoint, body });
      return {
        statusCode: 200,
        body: JSON.stringify({
          token_type: 'Bearer',
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 28800,
        }),
      };
    },
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.claudeAiOauth.accessToken, 'new-access');
  assert.strictEqual(result.claudeAiOauth.refreshToken, 'new-refresh');
  assert.strictEqual(result.claudeAiOauth.expiresAt, NOW + 28800 * 1000);
  assert.strictEqual(result.claudeAiOauth.refreshTokenExpiresAt, NOW + 999999);
  assert.strictEqual(result.claudeAiOauth.subscriptionType, 'max');
  assert.strictEqual(result.claudeAiOauth.rateLimitTier, 'default_claude_max_5x');
  assert.deepStrictEqual(result.claudeAiOauth.scopes, ['user:inference', 'user:profile']);

  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0].body, {
    grant_type: 'refresh_token',
    refresh_token: 'old-refresh',
    client_id: OAUTH_CLIENT_ID,
  });
});

test('refreshTokens: 400 -> revoked, no fallback attempt', async () => {
  let calls = 0;
  const result = await refreshTokens(storedOauth(), {
    httpPost: async () => {
      calls += 1;
      return { statusCode: 400, body: '{"error":"invalid_grant"}' };
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'revoked');
  assert.strictEqual(calls, 1);
});

test('refreshTokens: 429 -> rate-limited', async () => {
  const result = await refreshTokens(storedOauth(), {
    httpPost: async () => ({ statusCode: 429, body: '' }),
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'rate-limited');
});

test('refreshTokens: 404 on primary -> fallback endpoint succeeds', async () => {
  const endpoints = [];
  const result = await refreshTokens(storedOauth(), {
    now: () => NOW,
    httpPost: async (endpoint) => {
      endpoints.push(endpoint);
      if (endpoints.length === 1) return { statusCode: 404, body: '' };
      return {
        statusCode: 200,
        body: JSON.stringify({ access_token: 'fallback-access', refresh_token: 'fallback-refresh', expires_in: 100 }),
      };
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(endpoints.length, 2);
  assert.strictEqual(result.claudeAiOauth.accessToken, 'fallback-access');
});

test('refreshTokens: network failure on both endpoints -> network error', async () => {
  const result = await refreshTokens(storedOauth(), {
    httpPost: async () => { throw new Error('ECONNRESET'); },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'network');
});

test('refreshTokens: unparsable 200 body -> protocol error', async () => {
  const result = await refreshTokens(storedOauth(), {
    httpPost: async () => ({ statusCode: 200, body: 'not json' }),
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'protocol');
});

test('mergeRefreshedTokens: missing refresh_token in response keeps old one', () => {
  const merged = mergeRefreshedTokens(storedOauth(), { access_token: 'a2', expires_in: 10 }, NOW);
  assert.strictEqual(merged.refreshToken, 'old-refresh');
  assert.strictEqual(merged.accessToken, 'a2');
});
