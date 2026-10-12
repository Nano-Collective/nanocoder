---
'@nanocollective/nanocoder': patch
---

Fixed the startup artifact sweep deleting the plan, tasks and walkthrough of saved sessions when `sessions.autoSave` is off. The sweep read the session index before the sessions directory was resolved, so every saved session looked unknown. Fixes #1704.
