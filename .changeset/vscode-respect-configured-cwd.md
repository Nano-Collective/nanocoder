---
"@nanocollective/nanocoder": patch
---

Fix the VS Code extension using the `nanocoder.cwd` setting for some operations but the first workspace folder or the process directory for others, so the extension could disagree with the folder the CLI was running in. The extension client, the chat view, process manager and activation now share one resolver (`nanocoder.cwd`, then the first workspace folder, then the home directory). `@` mention search uses only the configured or workspace folder and never crawls the home directory.
