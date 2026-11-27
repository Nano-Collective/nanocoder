---
"@nanocollective/nanocoder": patch
---

`${VAR:-default}` in `agents.config.json`, MCP config and custom tool `env` now falls back to the default when `VAR` is set but empty (for example `export LOCAL_LLM_URL=`), as in the shell, instead of substituting an empty string. Bare `$VAR` and `${VAR}` still substitute the empty value. Closes #2400.
