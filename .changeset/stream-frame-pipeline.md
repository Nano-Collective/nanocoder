---
'@nanocollective/nanocoder': patch
---

Streamed tokens now reach the UI in ~50ms frames instead of 150ms batches, and the frame interval backs off (up to 400ms) while the event loop is running late, stepping back down once frames land on time again. The loop reading the model stream now yields every 16ms of work instead of every 200ms, so a backlog of buffered chunks no longer blocks keypresses and repaints for up to 200ms at a time. Closes #1582.
