---
"@nanocollective/nanocoder": patch
---

Fixed stray invalid UTF-8 bytes in the ACP agent and the nano architect-mode prompt section. Biome refused to read `source/acp/acp-agent.ts`, so `pnpm test:lint` and `pnpm test:format` failed with "stream did not contain valid UTF-8", and the corrupted em dashes showed up as replacement characters in the VS Code `/help` reply and the architect-mode system prompt. Closes #1862.
