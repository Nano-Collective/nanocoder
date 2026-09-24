---
"@nanocollective/nanocoder": patch
---

The Architect review gate now lists only files the turn actually changed or created, rather than every file a tool set out to touch, so a rejected or no-op edit no longer shows up as changed. A turn whose edits all failed skips the gate. Creating a new file no longer flashes a "Could not capture file" warning in the chat.
