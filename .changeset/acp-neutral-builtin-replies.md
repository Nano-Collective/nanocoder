---
"@nanocollective/nanocoder": patch
---

Built-in slash command replies over ACP (`/help`, `/copy`, `/model`, `/provider`, `/settings`, `/init`, `/theme`, `/compact`, `/context-max`, `/usage`) no longer describe the VS Code sidebar to other clients. The VS Code extension, recognised by the `clientInfo` it sends in `initialize`, keeps its wording unchanged; every other client, including one that sends no `clientInfo`, gets neutral text.
