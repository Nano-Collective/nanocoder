---
'@nanocollective/nanocoder': patch
---

Pasting now works in every text field, not just the main prompt. The terminal's bracketed-paste payload is lifted off stdin before Ink sees it and handed to whoever subscribes, and only the main prompt did, so a paste into the MCP and provider wizards, the settings panels, the `ask_user` prompt or the architect review's revise box was silently dropped. The shared text input now takes the paste whenever it has focus and inserts it at the caret; the main prompt keeps its own handling, which collapses long pastes into placeholders. Closes #1456.
