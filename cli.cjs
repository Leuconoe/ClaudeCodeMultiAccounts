#!/usr/bin/env node

const path = require('path');

const command = process.argv[2] || 'help';
const args = process.argv.slice(3);

function run(modulePath, forwardedArgs) {
  process.argv = [process.argv[0], modulePath, ...forwardedArgs];
  require(modulePath);
}

function showHelp() {
  console.log('Claude Code Multi-Account Switcher');
  console.log('');
  console.log('Usage:');
  console.log('  claude-code-multi-accounts install');
  console.log('  claude-code-multi-accounts uninstall');
  console.log('  claude-code-multi-accounts switch [selector]');
  console.log('  claude-code-multi-accounts sync');
}

switch (command) {
  case 'install':
    run(path.join(__dirname, 'install.cjs'), args);
    break;
  case 'uninstall':
    run(path.join(__dirname, 'uninstall.cjs'), args);
    break;
  case 'switch':
    run(path.join(__dirname, 'cc-switch.cjs'), args);
    break;
  case 'sync':
    run(path.join(__dirname, 'cc-switch.cjs'), ['sync', ...args]);
    break;
  case 'help':
  case '--help':
  case '-h':
    showHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error('Run with `help` to see supported commands.');
    process.exitCode = 1;
}
