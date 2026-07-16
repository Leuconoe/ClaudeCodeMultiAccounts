const https = require('https');

const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const TOKEN_ENDPOINTS = [
  'https://platform.claude.com/v1/oauth/token',
  'https://api.anthropic.com/v1/oauth/token',
];
const REQUEST_TIMEOUT_MS = 10000;

function postJson(endpoint, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(endpoint);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'claude-cli/claude-code-multi-accounts',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('token endpoint timeout'));
    });
    req.write(body);
    req.end();
  });
}

// The refresh response only carries access_token/refresh_token/expires_in;
// refreshTokenExpiresAt, scopes, subscriptionType, rateLimitTier must survive.
function mergeRefreshedTokens(claudeAiOauth, tokenResponse, now) {
  const merged = { ...claudeAiOauth };
  merged.accessToken = tokenResponse.access_token;
  if (tokenResponse.refresh_token) {
    merged.refreshToken = tokenResponse.refresh_token;
  }
  const expiresIn = Number(tokenResponse.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    merged.expiresAt = now + expiresIn * 1000;
  }
  return merged;
}

async function refreshTokens(claudeAiOauth, deps = {}) {
  const post = deps.httpPost || postJson;
  const now = deps.now || (() => Date.now());
  const endpoints = deps.endpoints || TOKEN_ENDPOINTS;
  let fallbackFailure = null;

  for (const endpoint of endpoints) {
    let res;
    try {
      res = await post(endpoint, {
        grant_type: 'refresh_token',
        refresh_token: claudeAiOauth.refreshToken,
        client_id: OAUTH_CLIENT_ID,
      });
    } catch (error) {
      fallbackFailure = { ok: false, code: 'network', message: `Token endpoint unreachable: ${error.message}` };
      continue;
    }
    if (res.statusCode === 200) {
      let parsed;
      try {
        parsed = JSON.parse(res.body);
      } catch {
        return { ok: false, code: 'protocol', message: 'Token endpoint returned an unparsable response.' };
      }
      if (!parsed.access_token) {
        return { ok: false, code: 'protocol', message: 'Token endpoint response is missing access_token.' };
      }
      return { ok: true, claudeAiOauth: mergeRefreshedTokens(claudeAiOauth, parsed, now()) };
    }
    if (res.statusCode === 400 || res.statusCode === 401) {
      return { ok: false, code: 'revoked', message: 'the stored refresh token was rejected (revoked or rotated)' };
    }
    if (res.statusCode === 429) {
      return { ok: false, code: 'rate-limited', message: 'the token endpoint is rate limiting requests' };
    }
    if (res.statusCode === 404 || res.statusCode === 403 || res.statusCode >= 500) {
      fallbackFailure = { ok: false, code: 'protocol', message: `token endpoint returned ${res.statusCode}` };
      continue;
    }
    return { ok: false, code: 'protocol', message: `token endpoint returned ${res.statusCode}` };
  }

  return fallbackFailure || { ok: false, code: 'network', message: 'no token endpoint could be reached' };
}

module.exports = { refreshTokens, mergeRefreshedTokens, OAUTH_CLIENT_ID, TOKEN_ENDPOINTS };
