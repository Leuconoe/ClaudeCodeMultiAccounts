function isSuspiciousDisplayName(value) {
  return value.includes('\uFFFD') || (value.match(/\?/g) || []).length >= 2;
}

function getPreferredDisplayName(metadata) {
  if (metadata?.displayName && String(metadata.displayName).trim()) {
    const displayName = String(metadata.displayName).trim();
    if (!isSuspiciousDisplayName(displayName)) {
      return displayName;
    }
  }

  if (metadata?.emailAddress && String(metadata.emailAddress).trim()) {
    const email = String(metadata.emailAddress).trim();
    const atIndex = email.indexOf('@');
    return atIndex > 0 ? email.slice(0, atIndex) : email;
  }

  return '(no display name)';
}

function getEntryLabel(entry) {
  const alias = entry && entry.alias ? String(entry.alias).trim() : '';
  if (alias) return alias;
  return getPreferredDisplayName((entry && entry.metadata) || {});
}

function inferPlanType(entry) {
  const metadata = entry.metadata || {};
  const credential = entry.credentials?.claudeAiOauth || {};
  const subscriptionType = credential.subscriptionType;
  const rateLimitTier = credential.rateLimitTier;

  if (subscriptionType === 'team') {
    return rateLimitTier === 'default_claude_max_5x' ? 'Team Premium' : 'Team Standard';
  }
  if (subscriptionType === 'enterprise') return 'Enterprise';
  if (subscriptionType === 'pro') return 'Pro';
  if (subscriptionType === 'max') return 'Max';

  const hasOrgScope = Boolean(metadata.organizationRole) || Boolean(metadata.workspaceRole);
  if (hasOrgScope) return metadata.billingType === 'stripe_subscription' ? 'Teams' : 'Enterprise';
  if (metadata.hasExtraUsageEnabled === true) return 'Max';
  if (metadata.billingType === 'stripe_subscription') return 'Pro';
  return 'Unknown';
}

function getCompactPlanLabel(entry) {
  const plan = inferPlanType(entry);
  switch (plan) {
    case 'Team Premium':
      return 'Team Prem';
    case 'Team Standard':
      return 'Team Std';
    case 'Enterprise':
      return 'Ent';
    case 'Unknown':
      return 'Unk';
    default:
      return plan;
  }
}

function truncate(text, maxLen) {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

function formatAccountSummary(accounts, deps) {
  const { formatRelativeTime, getUsageColumns } = deps;
  return accounts.map((entry) => {
    const marker = entry.current ? '*' : ' ';
    const displayName = truncate(getEntryLabel(entry), 18);
    const plan = getCompactPlanLabel(entry);
    const lastUsed = formatRelativeTime(entry.lastUsedAt);
    const usageColumns = getUsageColumns(entry);
    return `${marker} [${entry.index}] ${displayName} | ${plan} | ${usageColumns} | used:${lastUsed}`;
  });
}

module.exports = {
  getPreferredDisplayName,
  getEntryLabel,
  inferPlanType,
  getCompactPlanLabel,
  formatAccountSummary,
};
