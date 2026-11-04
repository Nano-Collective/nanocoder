---
"@nanocollective/nanocoder": patch
---

Fix the `/help` text of the VS Code chat showing a garbled character before each command description. `source/acp/acp-agent.ts` contained invalid UTF-8 bytes where an em dash was meant; they are now real em dashes, which also lets Biome read and format the file again.
