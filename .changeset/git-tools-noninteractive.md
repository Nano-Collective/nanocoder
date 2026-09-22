---
"@nanocollective/nanocoder": patch
---

Fixed the git tools hanging when git or gh needed input. `execProcess` now closes stdin, sets `GIT_TERMINAL_PROMPT=0`, and gives up after 60s, so a credential prompt fails with an error instead of freezing nanocoder. Thanks to @Piyushrathoree. Closes #1344.
