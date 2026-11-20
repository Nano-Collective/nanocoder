---
"@nanocollective/nanocoder": patch
---

`nanocoder config`, `nanocoder daemon` and any other code that loads the config module no longer pull in Ink and React at startup. The config loaders logged through the chat message queue, which imported the Ink message components, so these "no Ink" fast paths loaded the whole TUI stack (about 130 extra modules for `nanocoder config`). The queue now has a React-free core that non-UI modules log through, and messages still appear in the chat once the TUI is running.
