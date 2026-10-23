---
"@nanocollective/nanocoder": patch
---

The update banner no longer disappears for a day after it is first shown. A check that found a new version also started the 24 hour throttle, so later launches inside that window skipped the check and reported no update. The last check now remembers the latest version it found, and launches inside the window keep showing the banner, without a network request, until the installed version catches up.
