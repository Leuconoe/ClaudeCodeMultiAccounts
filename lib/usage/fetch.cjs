const https = require('https');

function fetchUsage(accessToken, cache) {
  return new Promise((resolve, reject) => {
    const req = https.get('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'anthropic-version': '2023-06-01',
        'User-Agent': 'claude-cli/claude-code-multi-accounts',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 429) {
          const retrySecs = res.headers['retry-after'] ? parseInt(res.headers['retry-after'], 10) : null;
          if (retrySecs) cache.setRateLimitResetAt(retrySecs);
          resolve({ rate_limited: true, retry_after: retrySecs });
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Usage API returned ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed?.seven_day?.resets_at) {
            cache.setRateLimitResetAtFromIso(parsed.seven_day.resets_at);
          }
          resolve(parsed);
        } catch {
          reject(new Error(`Failed to parse usage response: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Usage API timeout'));
    });
  });
}

module.exports = { fetchUsage };
