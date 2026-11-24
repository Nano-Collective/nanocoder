---
"@nanocollective/nanocoder": patch
---

Corrupt session files are now reported as unreadable with their path instead of "Session not found". Autosave moves them to a `.corrupt` backup before recreating the session, so the original bytes remain available for recovery. Closes #2243.
