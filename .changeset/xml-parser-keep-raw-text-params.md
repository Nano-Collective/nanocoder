---
"@nanocollective/nanocoder": patch
---

XML fallback tool calls now pass `content`, `old_str`, `new_str`, `command` and `path` through exactly as the model wrote them. Previously every parameter was run through `JSON.parse`, so a pretty-printed `package.json` written with `write_file` was minified, and values like `1.0`, `1e3` and `null` were changed to `1`, `1000` and an empty string. Other parameters, such as line numbers and file lists, are still parsed as before.
