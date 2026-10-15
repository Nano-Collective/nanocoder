---
'@nanocollective/nanocoder': patch
---

Fixed every start deleting the plan, task list and walkthrough of saved sessions older than a day when `sessions.autoSave` is `false`. The startup artifact sweep ran before the session store was set up, so it found no saved sessions and treated every artifact folder as orphaned. It now looks up the sessions directory itself (read-only, without creating the store or running retention), counts both the session files on disk and the index as saved sessions, and keeps everything if the store exists but cannot be read. Folders belonging to sessions that were never saved are still cleaned up as before. Thanks to @diyaavirmani. Closes #1704.
