---
'@nanocollective/nanocoder': minor
---

Make the fullscreen TUI the default for interactive sessions.

Interactive sessions now run on the terminal's alternate screen buffer, the way vim, less and htop do. The chat transcript is a bottom-anchored viewport that clips at the top instead of spilling into scrollback, so the prompt can never be pushed off-screen by a long turn, and the frame is repainted cleanly on resize. Scroll the transcript with PgUp / PgDn or the mouse wheel.

Inline mode is still available for anyone who wants finished messages to land in the terminal's own scrollback, where the terminal's scrollbar and search work: pass `--no-alt-screen`, or set `alternateScreen: false` in preferences. There is also an "Alternate Screen" toggle under `/settings`. Run mode (`nanocoder run ...`), non-TTY and CI environments are unaffected - they print a transcript you need to keep after exit, so they never enter the alternate screen.
