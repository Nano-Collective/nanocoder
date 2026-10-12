---
'@nanocollective/nanocoder': patch
---

Fixed saved sessions disappearing from `/resume`, `--continue` and `--resume` when two Nanocoder processes saved at the same time. The session index (`sessions.json`) was only locked within one process, so a second terminal, the VS Code extension or a parallel `nanocoder run` could overwrite it and drop the other session's entry, after which `nanocoder --resume last` in that project reported "No sessions found." Index updates now take a lock file shared by every process (the same heartbeat lock the memory store uses), and on startup the index is reconciled with the session files on disk, so sessions lost this way earlier are listed again and a deleted index is rebuilt. Thanks to @diyaavirmani. Closes #1706.
