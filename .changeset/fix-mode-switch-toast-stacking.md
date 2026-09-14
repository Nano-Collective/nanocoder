---
'@nanocollective/nanocoder': patch
---

Stop mode-switch model toasts stacking up.

Cycling development modes with Shift+Tab pushed a `[mode → model]` line into the transcript on every step, and the handler races ahead of prop updates, so a fast cycle left several identical lines in scrollback. Repeats of the same toast are now suppressed, and returning to normal mode posts nothing at all - that only restores your own default model, and the status bar already shows the change.
