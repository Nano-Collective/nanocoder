---
"@nanocollective/nanocoder": patch
---

Fix project plugins not being active for the first prompt. Plugins loaded in the background after startup, so the first chat prompt could run before their hooks existed. Startup now waits for `.mjs` plugins in a trusted directory, including an editor (ACP) session whose directory is already trusted. A `.js` file is not loaded, and a hook that returns the wrong shape is logged and skipped.
