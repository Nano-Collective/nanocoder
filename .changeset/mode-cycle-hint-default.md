---
'@nanocollective/nanocoder': patch
---

The `(Shift+Tab to cycle)` hint in the status line now shows by default instead of only on terminals under 80 columns. It was gated on the narrow-terminal check, so it appeared where space was tightest and never on a normal-width terminal; it is now included whenever the row has room and is dropped by the existing width budget when it doesn't. Closes #1453.
