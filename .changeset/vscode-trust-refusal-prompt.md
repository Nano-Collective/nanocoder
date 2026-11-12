---
"@nanocollective/nanocoder": patch
---

Fix the VS Code extension treating a folder trust refusal as a crash. When `nanocoder --acp` exits with code 3 because the folder is not trusted, the extension no longer restarts it five times and reports "Nanocoder CLI crashed repeatedly": it shows what the folder will run and offers to trust it, then starts the agent again. The status bar shows "Folder not trusted" until then.
