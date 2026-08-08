function getListGuidance(usageCommand) {
  return [
    `Run ${usageCommand} <index> to make one of these stored entries the active Claude account.`,
    `Run ${usageCommand} --remove <index> to remove a stored account.`,
  ];
}

function getRestartNotice() {
  return 'Note: Restart Claude Code to apply the account change.';
}

function getAvailableAccountsHeading() {
  return 'Available Claude accounts:';
}

function getStoredAccountsHeading() {
  return 'Stored account list:';
}

function getRemainingAccountsHeading() {
  return 'Remaining accounts:';
}

function getRunningSessionsWarning(count) {
  return `Warning: ${count} running Claude Code process(es) detected. They may rewrite credentials after the switch; close them and restart Claude Code once the switch completes.`;
}

function getForcedSwitchWarning(count) {
  return `Warning: forcing the switch with ${count} Claude Code session(s) running. They may rewrite ~/.claude.json and undo it.`;
}

function getSessionsBlockedLines(count, label, index, usageCommand, staged) {
  const lines = [
    `Cannot switch now: ${count} Claude Code session(s) are running.`,
    'A running session rewrites ~/.claude.json and would undo the switch, forcing a re-login.',
    '',
  ];
  if (staged) {
    lines.push(`Staged switch to [${index}] ${label}`);
    if (staged.watcher && staged.watcher.spawned) {
      lines.push('  Close every Claude Code window — the switch then applies by itself.');
      lines.push('  Your next Claude Code launch will be on the new account.');
    } else if (staged.watcher && staged.watcher.reason === 'already running') {
      lines.push('  A watcher is already waiting; it will apply this switch once every window closes.');
    } else {
      lines.push('  Close all Claude Code windows, then run in a terminal:');
      lines.push(`    ${usageCommand}`);
    }
    lines.push(`  Cancel with: ${usageCommand} cancel`);
  } else {
    lines.push('Close all Claude Code windows, then run in a terminal:');
    lines.push(`  ${usageCommand} ${index}`);
  }
  return lines;
}

function getStagedPendingNotice(staged, usageCommand) {
  return `Pending switch to ${staged.emailAddress || staged.key} (staged ${staged.stagedAt}). Run '${usageCommand}' with no Claude Code session running to apply, or '${usageCommand} cancel' to discard.`;
}

function getStagedApplyingNotice(label, index) {
  return `Applying staged switch to [${index}] ${label}...`;
}

function getStagedCancelledNotice(staged) {
  return `Cancelled the staged switch to ${staged.emailAddress || staged.key}.`;
}

function getStagedMissingNotice() {
  return 'No staged switch to cancel.';
}

function getStagedStaleNotice(staged) {
  return `The staged switch target (${staged.emailAddress || staged.key}) is no longer in the store; discarding it.`;
}

function getRefreshExpiryWarning(label, daysLeft) {
  return `Warning: ${label} requires a fresh login in ${daysLeft} day(s) (refresh token hard expiry). Log into it in Claude Code before then.`;
}

function getNeedsReauthNotice(label, usageCommand) {
  return `Note: ${label} is marked as needing a login. Log into it in Claude Code, then run '${usageCommand} sync' to re-capture it.`;
}

function getRefreshProgress(index) {
  return `Stored access token for [${index}] is expired or expiring soon - refreshing...`;
}

function getRefreshSuccess() {
  return 'Token refreshed.';
}

function getSwitchAbortedLines(abort, label, usageCommand) {
  const lines = [];
  if (abort.code === 'verify-failed') {
    lines.push(`Switch could not be confirmed: ${abort.reason}.`);
    lines.push('Close every Claude Code window and run the switch again from a terminal.');
    return lines;
  }
  if (abort.code === 'refresh-expired' || abort.code === 'revoked') {
    lines.push(`Switch aborted: the stored credentials for ${label} are no longer usable (${abort.reason}).`);
    lines.push('Your current live login was left untouched.');
    lines.push(`Recover that account by logging into it in Claude Code (/login), then run '${usageCommand} sync' to re-capture it.`);
  } else if (abort.code === 'rate-limited') {
    lines.push(`Switch aborted: ${abort.reason}.`);
    lines.push('Your current live login was left untouched. Try again in a few minutes.');
  } else {
    lines.push(`Switch aborted: ${abort.reason}.`);
    lines.push('Your current live login was left untouched.');
  }
  return lines;
}

function getSyncSkippedWarning(reason) {
  return `Warning: ${reason}`;
}

module.exports = {
  getListGuidance,
  getRestartNotice,
  getAvailableAccountsHeading,
  getStoredAccountsHeading,
  getRemainingAccountsHeading,
  getRunningSessionsWarning,
  getForcedSwitchWarning,
  getSessionsBlockedLines,
  getStagedPendingNotice,
  getStagedApplyingNotice,
  getStagedCancelledNotice,
  getStagedMissingNotice,
  getStagedStaleNotice,
  getRefreshExpiryWarning,
  getNeedsReauthNotice,
  getRefreshProgress,
  getRefreshSuccess,
  getSwitchAbortedLines,
  getSyncSkippedWarning,
};
