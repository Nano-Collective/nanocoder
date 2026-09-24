---
"@nanocollective/nanocoder": patch
---

The filterable pickers (`/checkpoint load`, `/resume`, model and provider lists) now fit a short terminal. The window only budgeted for the list's own rows, not the titled box and app frame around it, so on an 18-row terminal the hint and the box's bottom border were pushed off screen. The window also now shrinks when the terminal is resized while a picker is open.
