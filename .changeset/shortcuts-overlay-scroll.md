---
"@nanocollective/nanocoder": patch
---

Fixed the `?` keyboard shortcuts overlay running off the bottom of short terminals. It now shows only as many shortcuts as fit, keeps the close hint and lower border on screen, and scrolls with Up/Down and PgUp/PgDn. While it is open, the live task list and other status panels around the prompt are hidden so the overlay has room, and PgUp/PgDn scroll only the overlay, not the chat behind it. Closes #1813.
