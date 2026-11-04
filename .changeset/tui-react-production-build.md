---
'@nanocollective/nanocoder': patch
---

The interactive TUI now runs React's production build instead of the development one, which cuts the CPU used while a reply streams. `NODE_ENV` is set to `production` only while the TUI is loaded and is unset again right after, so commands run by tools still get the environment of the launching shell, and an explicit `NODE_ENV` is left as it is. `nanocoder --version` no longer loads React. Closes #1773.
