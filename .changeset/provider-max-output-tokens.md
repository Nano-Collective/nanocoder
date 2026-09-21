---
"@nanocollective/nanocoder": patch
---

Fixed the output-token ceiling being unsettable, which silently truncated long replies. The AI SDK renamed this setting to `maxOutputTokens` in v5; nanocoder was still sending the v4 name `maxTokens`, and because object spreads bypass TypeScript's excess-property checking it was dropped silently rather than failing to compile. Every request therefore fell back to whatever ceiling the provider inferred from the model id.

That matters most on `sdkProvider: "anthropic"`, where `@ai-sdk/anthropic` falls back to **4096 output tokens** for any model id it does not recognise as a Claude model. An Anthropic-compatible endpoint serving something else - MiniMax, for instance - had every reply cut off at 4096 with no error.

Two changes:

- The setting is now sent under the name the installed SDK reads, so `/tune`'s max-tokens control works again. It has been inert since the v5 upgrade, which also means the `Nano (low-end hardware)` preset's `maxTokens: 2048` now actually applies.
- Provider entries in `agents.config.json` accept `maxOutputTokens`. Headless runs never carry `/tune` parameters, so this is the only way to raise the ceiling in CI. A `/tune` value still wins where one is set.

Tests assert what reaches the wire rather than what typechecks, since typechecking demonstrably could not catch this.
