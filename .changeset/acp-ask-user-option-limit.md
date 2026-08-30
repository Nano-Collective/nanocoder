---
"@nanocollective/nanocoder": patch
---

Fixed `ask_user` rejecting 5-6 options over ACP. The tool schema allows 2-6 options, but the ACP path used by the VS Code extension capped them at 4, so an identical prompt succeeded in the CLI and failed in the editor. The bound now matches the schema, and the error string returned to the model says "2-6" rather than telling it the limit is 4 and pushing it to retry with a needlessly narrowed list. Closes #1036.