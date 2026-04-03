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

function inferPlanType(entry) {
  const metadata = entry.metadata || {};
  const credential = entry.credentials?.claudeAiOauth || {};
  const subscriptionType = credential.subscriptionType;

  if (subscriptionType === 'team') return 'Teams';
  if (subscriptionType === 'enterprise') return 'Enterprise';

  const hasOrgScope = Boolean(metadata.organizationRole) || Boolean(metadata.workspaceRole);
  if (hasOrgScope) return metadata.billingType === 'stripe_subscription' ? 'Teams' : 'Enterprise';
  if (metadata.hasExtraUsageEnabled === true) return 'Max';
  if (metadata.billingType === 'stripe_subscription') return 'Pro';
  return 'Unknown';
}

function formatAccountSummary(accounts, deps) {
  const { formatRelativeTime, getUsageColumns } = deps;
  return accounts.map((entry) => {
    const marker = entry.current ? '*' : ' ';
    const metadata = entry.metadata || {};
    const displayName = getPreferredDisplayName(metadata);
    const email = metadata.emailAddress && String(metadata.emailAddress).trim() ? metadata.emailAddress : '(no email)';
    const org = metadata.organizationName && String(metadata.organizationName).trim() ? metadata.organizationName : '(no organization)';
    const plan = inferPlanType(entry);
    const lastSynced = formatRelativeTime(entry.lastSyncedAt);
    const usageColumns = getUsageColumns(entry);
    return `${marker} [${entry.index}] ${displayName} <${email}> - ${org} - ${plan} | ${usageColumns} | synced: ${lastSynced}`;
  });
}

module.exports = {
  getPreferredDisplayName,
  inferPlanType,
  formatAccountSummary,
};
