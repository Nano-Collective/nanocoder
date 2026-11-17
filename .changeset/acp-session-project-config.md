---
"@nanocollective/nanocoder": minor
---

ACP sessions now read the project `agents.config.json` of their own folder. A session whose `cwd` is a different project than the one `nanocoder --acp` started in gets that project's `alwaysAllow`, `disabledTools`, lifecycle hooks, formatters, `sandbox`, `firewall`, `autoCommit`, auto-compact and retry settings, `systemPrompt`, tune and provider list. Before, every session used the launch folder's settings while its tools, prompt and `AGENTS.md` followed its own folder. A session in the launch folder is unchanged. The starting provider and model, `.mcp.json` servers, custom tools, commands and skills still come from the launch folder.
