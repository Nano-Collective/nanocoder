---
"@nanocollective/nanocoder": minor
---

Upgrades Ink from 6.8 to 8.0. Ink 8 requires React 19.3+ (already satisfied), types `useStdout()`'s stream as a plain Node.js `WritableStream`, and drops terminal control sequences it cannot map to a key before they reach `useInput`. Two behaviours adapted to that:

- The stdin proxy now rewrites xterm's modifyOtherKeys form of Enter with a modifier (`ESC [27;<m>;13~`, sent by the VS Code integrated terminal) into the equivalent kitty CSI-u encoding (`ESC [13;<m>u`), which Ink parses natively. Previously this arrived with an empty key name and was matched on a patched-in `key.raw` property; Ink 8 drops such sequences outright, so the rewrite keeps Shift+Enter / Alt+Enter newline insertion working without the patch.
- The custom `raw`-sequence Backspace/Delete disambiguation in the prompt was removed — since Ink 7, the physical Backspace byte (`\x7f`) and Alt+Backspace set `key.backspace`, distinct from forward Delete (`\x1b[3~)`) setting `key.delete`, so the standard flags are now authoritative.

The startup-time patch importing `es-toolkit/compat/throttle` directly instead of the barrel file is carried over to Ink 8.
