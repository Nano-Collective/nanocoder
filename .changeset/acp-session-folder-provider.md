---
"@nanocollective/nanocoder": patch
---

An ACP session in a different project than the one `nanocoder --acp` started in now starts on that project's provider and model: your last-used provider if the project configures it, else its first one. Before, it always started on the launch folder's provider, which that project might not configure at all. A project that configures the same provider the same way keeps sharing the agent's client, and a session whose project has no reachable provider stays on the agent's current one.
