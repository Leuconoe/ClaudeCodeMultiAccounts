---
description: Show saved Claude OAuth accounts and switch `oauthAccount` by index, email, or account UUID.
argument-hint: [index|email|accountUuid]
allowed-tools: ["Bash(node ./cc-switch.cjs:*)"]
disable-model-invocation: true
---

Run the local Node wrapper and use its output as the command result.

```!
node ./cc-switch.cjs --usage-command "/cc-switch" $ARGUMENTS
```
