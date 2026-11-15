---
"@nanocollective/nanocoder": patch
---

Preserve raw text and formatting in string parameters during XML tool-call parsing, preventing pretty-printed JSON from being minified and literal strings ('null', '1.0', '1e3') from being coerced into primitives. Closes #2203.
