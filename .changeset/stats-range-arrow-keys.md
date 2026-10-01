---
"@nanocollective/nanocoder": patch
---

Fixed `/stats` dropping arrow-key presses and freezing on a range tab. The range stepped from the value captured in the input handler's closure, but Ink re-registers that handler in a passive effect that runs after the frame is painted — so a press arriving before the effect landed was dispatched with the previous render's range, recomputed the tab it had already moved to, and wedged there until another key broke the tie. The range now steps from the value React holds.
