---
"@nanocollective/nanocoder": minor
---

Moved the rest of nanocoder's configuration into the `/settings` menu, so you can set things up without editing `.json` files by hand. Settings are grouped into Appearance, Input, Behavior, Providers, and Advanced tabs. New menu items let you set the default mode, auto-compact, sessions, reasoning traces, tool auto-approval, and a Web Search API key; view your configured providers and MCP servers before opening the setup wizards; open the Tune Model and Connect IDE wizards; and see the active `NANOCODER_*` environment variables. Advanced also includes an in-app JSON editor for `agents.config.json`: edit strings with the cursor inside the quotes, flip booleans with the arrow keys, and save atomically (a crash can't leave a half-written file).
