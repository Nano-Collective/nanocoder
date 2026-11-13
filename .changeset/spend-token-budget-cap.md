---
'@nanocollective/nanocoder': minor
---

Added a spend and token budget cap for runs and sessions. `nanocoder run` accepts `--max-budget-usd <n>` and `--max-tokens-total <n>`; `nanocoder.budget` in agents.config.json sets `perRunUsd`, `perSessionUsd` and `maxTokensTotal` for headless runs, interactive sessions and the daemon. Running totals come from the existing usage module (provider-reported tokens priced via models.dev). At 80% of a limit a warning is shown; at 100% the run stops before the next request, prints the total spent, and exits with code 3 in `--plain` mode. Interactive sessions ask whether to stop, continue once, or raise the limit. Models with no price in models.dev fall back to the token limit only and report their cost as unknown instead of zero.
