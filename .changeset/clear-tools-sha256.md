---
'@nanocollective/nanocoder': patch
---

Fixed Homebrew installation of Nanocoder 1.32.0 failing because the formula used an incorrect npm tarball SHA-256 checksum. The release updater now stops on HTTP errors instead of hashing the error response. Closes #1997.
