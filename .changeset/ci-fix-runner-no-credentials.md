---
"@nanocollective/nanocoder": patch
---

Stop the daemon's CI auto-fix run from being able to publish on its own. At `auto-fix` and `full-commit` trust the fix agent runs shell commands without approval, steered by a CI log an attacker can influence, and it inherited the user's GitHub token, gh login, ssh-agent and git credential helpers, so an injected instruction could `git push --force` or `gh pr merge`. The fix run now starts with those credentials removed and pushes blocked, the daemon fetches the failed-step log for it up front, and the daemon publishes the commits itself from the project repository rather than from the clone the agent could have reconfigured. Provider API keys in the environment are unaffected, but a provider configured to read `GITHUB_TOKEN` or `GH_TOKEN` will not see it inside the fix run.
