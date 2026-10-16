---
"@nanocollective/nanocoder": patch
---

Fixed the UI sometimes not re-laying out after a terminal resize. Layout reactivity came from the clamped box width, so any resize that landed inside a clamp (below 44 or above 204 columns) produced no re-render and left the welcome screen, input box, status bar and session selector sized for the old terminal. Width now derives from a reactive raw column count. Closes #1328.
