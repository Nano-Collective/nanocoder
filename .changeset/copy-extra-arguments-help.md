---
'@nanocollective/nanocoder': patch
---

Fixed `/copy` reporting `Unknown option "code"` when extra arguments were passed. `/copy` with more than one argument now returns `Too many arguments. Usage: /copy [code]`, and the `/copy` help text documents the optional `[code]` argument. Closes #1748.
