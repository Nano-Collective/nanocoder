---
"@nanocollective/nanocoder": patch
---

Secret redaction in verify reports now replaces environment secret values as literal text instead of building a regular expression from them. The output is unchanged; this clears the Semgrep `detect-non-literal-regexp` finding that was failing the security scan on every pull request.
