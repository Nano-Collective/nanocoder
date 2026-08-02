---
"@nanocollective/nanocoder": patch
---

Fixed update checks incorrectly recording a successful check after a registry fetch failure, corrected `BoundedMap.has()` for entries whose value is `undefined`, and restored network-error classification for Node.js errno codes. Closes #739, #738, and #737.
