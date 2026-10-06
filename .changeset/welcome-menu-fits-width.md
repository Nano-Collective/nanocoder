---
"@nanocollective/nanocoder": patch
---

Fixed the welcome screen's menu wrapping apart on narrow terminals, with each command landing on its own line. The menu now steps down to the short version, or is left out, when its rows would not fit the terminal width, the same way it already does for height. Closes #1434.
