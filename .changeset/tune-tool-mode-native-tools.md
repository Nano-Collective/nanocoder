---
"@nanocollective/nanocoder": patch
---

Fix `/tune`'s XML and JSON tool modes still sending native tools. Picking a text tool mode put the tool definitions into the system prompt, but the request kept sending the native tool list too, so the model saw two different ways to call tools and replies were handled as native turns. The TUI, `--plain`/`run` and ACP sessions now leave native tools off the request whenever tune selects XML or JSON.
