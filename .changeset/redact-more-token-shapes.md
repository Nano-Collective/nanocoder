---
"@nanocollective/nanocoder": patch
---

Secret redaction in `nanocoder verify` and CI-watch output now also masks Google API keys (`AIza...`), GitLab tokens (`glpat-`, `gldt-`, `glrt-`, `glptt-`, `glsoat-`), Stripe secret and restricted keys (`sk_live_`, `rk_live_`, `sk_test_`, `rk_test_`) and JWTs, alongside the GitHub, OpenAI/Anthropic, AWS and Slack shapes it already caught.
