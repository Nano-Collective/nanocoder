---
"@nanocollective/nanocoder": patch
---

`--continue` and `/resume last` now find sessions saved from the same project when the working directory differs only by letter case or a trailing separator on Windows (for example `c:\work\proj` from a VS Code terminal and `C:\Work\Proj` from PowerShell). Session lookup by directory used a plain string comparison before.
