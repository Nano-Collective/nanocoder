---
"@nanocollective/nanocoder": patch
---

`execute_bash` and `!command` no longer pass nanocoder's own provider credentials to the commands they run. Variables holding a configured provider `apiKey` (or the web search key) and `NANOCODER_PROVIDERS` are removed from the child environment. With `nanocoder.sandbox` on, the well-known provider key variables such as `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are removed too. Other variables, such as `GH_TOKEN`, are passed through unchanged.
