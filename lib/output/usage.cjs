function formatRelativeTime(isoString) {
  if (!isoString) return 'never';
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 0) return 'just now';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatResetEstimate(isoString, accountKey, getRateLimitResetAt, resetWindowDays) {
  const rateLimitReset = getRateLimitResetAt();
  if (rateLimitReset && accountKey) {
    const diff = rateLimitReset - Date.now();
    if (diff > 0) {
      const hours = Math.floor(diff / 3600000);
      if (hours >= 24) {
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        return `~${days}d ${remainingHours}h`;
      }
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      if (hours > 0) return `~${hours}h ${minutes}m`;
      if (minutes > 0) return `~${minutes}m ${seconds}s`;
      return `~${seconds}s`;
    }
  }

  if (!isoString) return 'unknown';
  const resetDate = new Date(new Date(isoString).getTime() + resetWindowDays * 86400000);
  const diff = resetDate.getTime() - Date.now();
  if (diff <= 0) return 'reset now';
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `~${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `~${days}d ${remainingHours}h`;
}

function formatUsageInfo(usage) {
  const lines = [];
  if (usage.rate_limited) {
    const retrySecs = usage.retry_after ? parseInt(usage.retry_after, 10) : null;
    if (retrySecs) {
      const resetAt = new Date(Date.now() + retrySecs * 1000);
      const h = Math.floor(retrySecs / 3600);
      const m = Math.floor((retrySecs % 3600) / 60);
      const s = retrySecs % 60;
      let countdown = '';
      if (h > 0) countdown = `~${h}h ${m}m`;
      else if (m > 0) countdown = `~${m}m ${s}s`;
      else countdown = `~${s}s`;
      lines.push(`Usage API is rate limited. Resets in ${countdown} (at ${resetAt.toLocaleTimeString()}).`);
    } else {
      lines.push('Usage API is rate limited. Try again in a few seconds.');
    }
    return lines;
  }
  if (usage.five_hour) {
    const pct = typeof usage.five_hour.utilization === 'number' ? usage.five_hour.utilization.toFixed(1) : 'N/A';
    const resetsAt = usage.five_hour.resets_at ? new Date(usage.five_hour.resets_at).toLocaleString() : 'unknown';
    lines.push(`5h used/reset: ${pct}% / ${resetsAt}`);
  }
  if (usage.seven_day) {
    const pct = typeof usage.seven_day.utilization === 'number' ? usage.seven_day.utilization.toFixed(1) : 'N/A';
    const resetsAt = usage.seven_day.resets_at ? new Date(usage.seven_day.resets_at).toLocaleString() : 'unknown';
    lines.push(`7d used/reset: ${pct}% / ${resetsAt}`);
  }
  if (lines.length === 0) {
    lines.push('No usage data available for this account.');
  }
  return lines;
}

function formatUsagePercent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '?';
  return `${Math.round(value)}%`;
}

function formatDurationUntil(dateLike) {
  if (!dateLike) return 'unknown';
  const resetAt = new Date(dateLike).getTime();
  if (Number.isNaN(resetAt)) return 'unknown';
  const diff = resetAt - Date.now();
  if (diff <= 0) return 'now';
  const totalHours = Math.floor(diff / 3600000);
  if (totalHours >= 24) {
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return `${days}D ${hours}h`;
  }
  const minutes = Math.floor((diff % 3600000) / 60000);
  return `~${totalHours}h ${minutes}min`;
}

function getUsageColumns(entry, getRateLimitResetAt) {
  const usage = entry.usageSnapshot || {};
  const rateLimitReset = entry.current ? getRateLimitResetAt() : null;
  const fiveHourPct = formatUsagePercent(usage.five_hour?.utilization);
  const fiveHourReset = formatDurationUntil(usage.five_hour?.resets_at);
  const sevenDayPct = formatUsagePercent(usage.seven_day?.utilization);
  const sevenDayReset = formatDurationUntil(rateLimitReset || usage.seven_day?.resets_at);
  return `5H:${fiveHourPct}(${fiveHourReset}) | 7D:${sevenDayPct} (${sevenDayReset})`;
}

module.exports = {
  formatRelativeTime,
  formatResetEstimate,
  formatUsageInfo,
  formatUsagePercent,
  formatDurationUntil,
  getUsageColumns,
};
