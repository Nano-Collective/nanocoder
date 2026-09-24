---
"@nanocollective/nanocoder": patch
---

Fixed Settings → Nanocoder Shape doing nothing. The welcome screen redesign hardcoded the wordmark to the block font, so the panel kept previewing and saving a shape that never reached the banner. The banner reads the preference again, and now subscribes to preference writes so the new shape appears as soon as the panel is closed rather than on the next restart. The width and height thresholds that decide between "NANOCODER", the "NC" monogram and no wordmark at all are per-font too, so a short font like chrome gets the full wordmark on a 50-column terminal and a tall one like huge no longer pushes the menu and tip off screen. The default the settings panel reports is also the one now on screen: block, not tiny.
