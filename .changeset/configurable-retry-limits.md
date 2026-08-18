---
"@nanocollective/nanocoder": minor
---

Add configurable agent-loop retry limits to prevent token drain (#897). A new `nanocoder.retries` section in `agents.config.json` exposes the previously hardcoded caps: `maxRepeatedToolCalls` (default 3), `maxEmptyTurns` (default 2), and `maxMalformedRetries` (default 2). When the repeated-tool-call limit is hit in an interactive session, Nanocoder now pauses and asks whether to continue (granting another window of attempts) or stop, instead of always hard-stopping; non-interactive runs keep the hard stop. The same limits now also protect the `--plain` runtime used by `nanocoder run` in CI and non-TTY environments, which previously had no repeated-call, empty-turn, or malformed-retry caps at all: each cap hard-stops with a clear error there.
