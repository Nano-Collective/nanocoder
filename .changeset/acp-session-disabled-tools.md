---
"@nanocollective/nanocoder": minor
---

ACP clients can now turn tools off for a single session. Send `_meta: {"nanocoder/disabledTools": ["browser"]}` on `session/new`, `session/load` or `session/resume`, for example to stop Nanocoder's built-in browser when the editor provides its own. The names are added to the user's own `disabledTools`, never replacing it, and apply to that session only: the tools are left out of the tool list and the prompt, a call the model makes to one anyway is refused and nothing runs, and subagents the session starts respect the same list. The response `_meta` reports the list in effect under the same key so a client can verify it. The list is not saved with the session and the user's config files are never read or changed for this. The approval policy the response reports no longer lists a tool the session has turned off. Sessions that send nothing are unchanged.
