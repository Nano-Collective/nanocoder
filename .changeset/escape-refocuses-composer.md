---
'@nanocollective/nanocoder': patch
---

Pressing Escape in the composer no longer leaves it unable to accept typing. Ink drops keyboard focus on every Escape, and only the second Escape that clears the prompt took it back, so dismissing the next-command suggestion, closing the `?` shortcuts legend or the command menu, arming the clear hint, or pressing Escape on an empty prompt left the input dead until a turn ended or Shift+Tab was pressed. Every Escape that leaves the composer on screen now returns focus to it.
