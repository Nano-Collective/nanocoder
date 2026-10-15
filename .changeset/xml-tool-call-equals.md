---
"@nanocollective/nanocoder": patch
---

XML tool calls whose values contain `=` are no longer silently dropped on the XML fallback path. The validator rejected any block containing `=` to catch `<function=name>` / `<parameter=name>` tags, which also discarded ordinary calls like `FOO=1 echo hi` or a `string_replace` of `const x = 1;`. It now only rejects those attribute-style tags. Tool-call text quoted inside another call's arguments (a `<function=...>` or JSON call, or a code fence inside an XML call such as markdown written by `write_file`) now stays part of that argument instead of being run as its own call. Closes #1630.
