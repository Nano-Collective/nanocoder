---
"@nanocollective/nanocoder": patch
---

Fixed Backspace acting as forward Delete in the prompt (and in the MCP wizard) on npm installs, and restored the Shift+Enter / Alt+Enter newline chords that depend on the same check. The key-disambiguation relied on a pnpm patch to Ink that only applied inside the repo, so published installs ran stock Ink and lost it. The raw key sequence is now read from Ink's stdin event emitter, which needs no patch.
