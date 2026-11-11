---
"@nanocollective/nanocoder": patch
---

Fix ACP `session/delete` and `session/resume` on a session with a prompt still running. A delete now cancels the turn and waits for it, so the turn's last save can no longer bring the deleted session back. A resume retires the live copy first, so one session id never has two sessions running side by side, and it starts from the history the cancelled turn saved.
