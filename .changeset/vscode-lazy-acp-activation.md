---
"@nanocollective/nanocoder": minor
---

The VS Code extension no longer starts with every VS Code window. It used to activate on `onStartupFinished` and immediately spawn `nanocoder --acp`, using memory and CPU even in windows where Nanocoder was never opened. It now activates when the Nanocoder view is opened or a Nanocoder command runs, and spawns the agent process the first time the chat view opens; commands that don't talk to the agent (Open Configuration, Show Output, the legacy companion) no longer start it. The legacy `nanocoder.autoConnect` companion setting now connects when the extension activates rather than at window startup. Closes #1729.
