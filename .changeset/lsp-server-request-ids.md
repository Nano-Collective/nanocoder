---
"@nanocollective/nanocoder": patch
---

A request from the language server, such as `workspace/configuration`, is no longer mistaken for the response to one of our requests when the ids collide. The client answers the server and leaves the matching pending request in flight. Closes #2205.
