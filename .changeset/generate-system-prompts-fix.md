---
"@nanocollective/nanocoder": patch
---

Fix `pnpm generate:system-prompts` exiting with code 1 and no message. The script now uses `registry.getNativeTools()`, generates variants for the real development modes (mirroring `MODE_EXCLUDED_TOOLS` from `source/tools/tool-manager.ts` instead of the removed `scheduler` mode), and prints the error and exits non-zero if generation fails.
