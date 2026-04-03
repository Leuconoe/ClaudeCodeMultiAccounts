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

module.exports = {
  getListGuidance,
  getRestartNotice,
  getAvailableAccountsHeading,
  getStoredAccountsHeading,
  getRemainingAccountsHeading,
};
