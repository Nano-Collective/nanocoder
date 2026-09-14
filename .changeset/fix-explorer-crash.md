---
'@nanocollective/nanocoder': patch
---

Fix `/explorer` crashing the CLI.

Running `/explorer` killed the process with exit code 1 and `useUIStateContext must be used within a UIStateProvider`. The provider wrapped only the chat input, while the file explorer renders as a sibling, so the hook threw during render and took Ink down with it.

The same placement broke the feature even without the crash: explorer mode unmounts the chat input, so the provider holding the explorer's selection went with it and the files could never have reached the prompt. The provider now wraps the whole interactive tree, and picking files in the explorer inserts them as `@` mentions when you exit.
