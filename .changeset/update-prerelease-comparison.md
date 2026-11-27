---
"@nanocollective/nanocoder": patch
---

Fixed update checks treating a stable release and its prerelease as the same version. Users running a prerelease such as `1.2.3-beta.1` are now told when the stable `1.2.3` release is available, and build metadata no longer affects the comparison.
