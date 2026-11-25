---
"@nanocollective/nanocoder": patch
---

`nanocoder skills` no longer loads Ink and React. Loading a bundle's custom tools pulled in the tool-call formatter component, so `nanocoder skills check` and `nanocoder skills add` paid for the whole TUI stack on startup. The formatter is now loaded the first time a custom tool call is displayed.
