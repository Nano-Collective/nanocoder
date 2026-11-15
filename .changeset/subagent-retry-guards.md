---
"@nanocollective/nanocoder": minor
---

Subagents now get the same retry limits and turn ceiling as `--plain` and ACP runs. An empty reply is nudged instead of being handed back as the answer, a malformed XML/JSON tool call is sent back for correction (so a subagent on a model without native tool calling can call tools at all), a reply cut off at the output-token limit is asked to continue, and a run that keeps calling tools stops at a turn ceiling after a final tool-free turn. The ceiling is the headless `maxTurns` (200) unless the new `nanocoder.headless.subagentMaxTurns` sets its own. Hitting any limit fails the subagent with an error naming the setting, and its partial output still reaches the main agent.
