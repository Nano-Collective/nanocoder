---
"@nanocollective/nanocoder": patch
---

Replies with many cut-off JSON tool calls no longer freeze the tool-call parser. Before, each unfinished call could rescan the rest of the reply, so a few hundred KB of broken calls took seconds to parse. The scan now stops at a raw line break inside a JSON string and has a fixed work limit per reply. A reply that uses up the limit is rejected with a retry prompt instead of running XML that may be quoted inside an unscanned call. JSON-looking text inside a valid XML call's arguments, such as a `write_file` of docs, is still treated as that call's content. Closes #1803.
