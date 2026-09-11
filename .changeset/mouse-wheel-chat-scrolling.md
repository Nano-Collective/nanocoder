---
'@nanocollective/nanocoder': minor
---

Scroll the chat transcript with the mouse wheel, and stop the wheel cycling prompt history.

The alternate screen has no native scrollback, so the terminal's own wheel and scrollbar cannot work there - the app has to receive wheel events itself. Nanocoder now enables SGR mouse reporting in fullscreen mode and scrolls the transcript three rows per tick. Text selection in that mode is Shift+drag (Option+drag in iTerm2).

Prefer native double-click and drag selection? Pass `--no-mouse`, set `mouseReporting: false` in preferences, or use the "Mouse Wheel Reporting" toggle under `/settings`. The wheel then no longer scrolls the transcript.

This also fixes a bug in that opted-out path. Terminals enable alternate scroll mode (DECSET 1007) by default: while the alt screen is active and the app is not reporting mouse events, they translate wheel ticks into cursor up/down key sequences. Those are indistinguishable from real arrow keys, so scrolling the wheel cycled through prompt history instead of the transcript. Nanocoder now turns that mode off for the lifetime of the session and restores it on exit.
