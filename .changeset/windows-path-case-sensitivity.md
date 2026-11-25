---
"@nanocollective/nanocoder": patch
---

Normalize path comparisons to lowercase on Windows (`win32`) in `isPathInside` and directory trust checks under standard Win32 case-insensitive filesystem semantics. Windows filesystems are case-insensitive by default, so paths differing only in case (e.g. `c:\work\proj` vs `C:\Work\Proj`, or uppercase drive letters) are now correctly recognized as contained within the workspace root and match existing entries in `trustedDirectories` without re-prompting or rejecting valid absolute paths. Closes #1689.
