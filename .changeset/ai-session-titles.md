---
"@nanocollective/nanocoder": minor
---

Added automatic session titles.
A session keeps its opening prompt as the title, and when that prompt is too thin to be useful the agent generates a descriptive name once, after the first turn that ran a tool or the first follow-up message.
Manual renames are never overwritten.

Titling runs in the ACP agent, so it applies to the VS Code extension and other ACP clients; the CLI keeps its heuristic title.
It uses the session's own model by default - set `sessions.titleModel` / `sessions.titleProvider` to point it at a cheaper or local one, or `sessions.smartTitles: false` to turn it off.
Pointing `titleProvider` at a different provider sends it the opening user turns and a summary of the tools that ran, which includes file paths and bash command strings.

Two things worth knowing:
the tokens a title costs are billed by the provider but are not counted in `/usage`, since the call is made outside the conversation loop that builds usage records;
and existing sessions are retitled from their first message on their next autosave, which is a one-time visible reshuffle of the history list.

Also fixed the CLI's autosave deriving the session title from the latest user message and rewriting it on every save, which overwrote titles in the store the VS Code extension reads from.
Closes #808.
