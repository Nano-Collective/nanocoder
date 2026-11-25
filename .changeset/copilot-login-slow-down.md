---
"@nanocollective/nanocoder": patch
---

The GitHub Copilot device login now keeps polling, at a longer interval, when GitHub answers `slow_down`, instead of failing with "Authorization failed: slow_down". Closes #2336.
