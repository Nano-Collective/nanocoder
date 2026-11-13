---
'@nanocollective/nanocoder': patch
---

Fixed Homebrew installation of Nanocoder 1.32.0 failing because the formula used an incorrect npm tarball SHA-256 checksum. The release updater now rejects HTTP errors and validates a temporary formula before replacing the existing one. Closes #1997.
