---
'@nanocollective/nanocoder': patch
---

Closing every editor in VS Code now clears the active file Nanocoder attaches to each prompt, so the agent no longer keeps referring to a file you already closed. New and resumed ACP sessions also pick up the file that is open at the time, instead of waiting for you to switch editors. Thanks to @Piyushrathoree. Closes #1724.
