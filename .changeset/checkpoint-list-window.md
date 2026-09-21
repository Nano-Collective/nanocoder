---
"@nanocollective/nanocoder": patch
---

`/checkpoint load` now shows a windowed, filterable list instead of rendering every checkpoint at once. A project with a few dozen checkpoints pushed the picker well past the visible terminal. It now uses the same list component as session history, so typing filters, the window scrolls with the highlight, and it shrinks further on short terminals. Closes #1372.
