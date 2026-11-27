---
"@nanocollective/nanocoder": patch
---

Built-in slash commands now run whatever case you type them in: `/Status`, `/COMPACT` and `/Setup-MCP` work like their lowercase forms. Before, only `/resume`, `/sessions`, `/history` and `/retry` accepted other cases, and every other command reported `Unknown command`. Custom commands and MCP prompts still match their exact name. `/sessions` and `/history` are now ordinary aliases of `/resume`, so a fully typed `/sessions` completes to itself in the slash menu like the other old names.
