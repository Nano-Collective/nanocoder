---
"@nanocollective/nanocoder": patch
---

Fixed Escape not fully cancelling a turn. Each turn could end up with two abort controllers, so the checks that run after the turn missed the cancel: a cancelled plan-mode turn could still save a fallback plan and open the plan review, a cancelled architect turn could still open the checkpoint review, and pressing Escape while project memories were being recalled did not stop the model call that followed. A turn now has a single controller, and every one of these checks sees the cancel.
