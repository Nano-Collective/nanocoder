---
"@nanocollective/nanocoder": patch
---

Fixed a leaked pending slot in the daemon IPC client. If serializing or writing a request threw synchronously, the request's entry stayed in the pending map for the lifetime of the client, one per failed request. The slot is now released and the request rejected explicitly. Closes #1040.
