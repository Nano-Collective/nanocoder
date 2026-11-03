---
"@nanocollective/nanocoder": minor
---

Upgrades Ink from 6.8 to 8.0 and raises the React dependency floor to 19.3. Ink 8 types `useStdout()`'s stream as a plain Node.js `WritableStream` and drops terminal control sequences it cannot map to a key before they reach `useInput`.

- The stdin proxy rewrites xterm's modifyOtherKeys form of modified Enter (`ESC [27;<m>;13~`, used by VS Code terminal keybindings) into kitty CSI-u (`ESC [13;<m>u`), which Ink parses natively. Fragmented sequences are reassembled before rewriting.
- Preserves the patch-independent raw-input handling introduced by #1670, including its guard against reading `key.raw`. Backspace and forward Delete remain distinct; the upgrade does not revert the packaging fix.

The startup-time patch importing `es-toolkit/compat/throttle` directly instead of the barrel file is carried over to Ink 8.

Related input regressions: #1505 (already fixed on main by #1670) and #1664. This upgrade is related follow-up work, not a claim that those reports require Ink 8. See [terminal compatibility checks](../docs/features/terminal-compatibility.md) for automated coverage and the manual smoke-test procedure.
