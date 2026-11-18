---
"@nanocollective/nanocoder": patch
---

Ctrl+V image paste no longer freezes the input box while the clipboard helper runs. The clipboard read is asynchronous now, so a cold PowerShell start on Windows or a slow `wl-paste`/`xclip` lookup on Linux leaves the TUI responsive. When the helper is missing, takes longer than 3 seconds, or the image is over 10 MB, a one-line note above the prompt explains why nothing was attached instead of the paste failing silently. Closes #2012.
