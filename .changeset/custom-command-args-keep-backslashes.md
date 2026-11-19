---
"@nanocollective/nanocoder": patch
---

Custom command arguments now keep backslashes in Windows paths such as `C:\src\app.ts`. A backslash only escapes a quote, whitespace or another backslash.
