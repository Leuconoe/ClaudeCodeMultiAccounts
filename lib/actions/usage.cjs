async function runUsageAction(context) {
  const { credentials, fetchUsage, formatUsageInfo, setRateLimitResetAt, setRateLimitResetAtFromIso, ensureDir } = context;
  const accessToken = credentials?.claudeAiOauth?.accessToken;
  if (!accessToken) {
    throw new Error('No access token found in credentials file.');
  }
  console.log('Fetching usage from Claude API...');
  const usage = await fetchUsage(accessToken, {
    setRateLimitResetAt: (secs) => setRateLimitResetAt(secs, ensureDir),
    setRateLimitResetAtFromIso: (iso) => setRateLimitResetAtFromIso(iso, ensureDir),
  });
  for (const line of formatUsageInfo(usage)) console.log(line);
}

module.exports = { runUsageAction };
