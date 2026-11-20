---
"@nanocollective/nanocoder": minor
---

An ACP session in a different project than the one `nanocoder --acp` started in now gets that project's custom tools, custom commands, skills and the MCP servers of its `.mcp.json`, instead of the launch folder's. They are set up when the first session opens in that folder, shared by its sessions, and disconnected when the agent exits. Sessions in the launch folder are unchanged. Subagents from a skill bundle also stay registered when sessions in different folders run subagents, instead of being dropped each time the folder changes.
