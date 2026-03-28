---
description: Sync the current Claude `oauthAccount` into `oauthList`.
allowed-tools: ["Bash(node ./cc-switch.cjs:*)"]
disable-model-invocation: true
---

Run the local Node wrapper in sync mode and use its output as the command result.

```!
node ./cc-switch.cjs sync
```
