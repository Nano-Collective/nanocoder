---
"@nanocollective/nanocoder": patch
---

`<think>` is only stripped where it is reasoning: a tag inside a tool-call argument (XML, `<function=name>` or JSON) is file content and survives, and prose that mentions the tag is no longer cut off. The interactive frontend, which pre-strips the reply, now uses the same tool-call-aware pass.
