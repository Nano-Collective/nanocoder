---
'@nanocollective/nanocoder': patch
---

Tool-execution safety fixes:

- Tool approval: never auto-approve a call whose arguments fail schema
  validation. The approval prompt now renders together with the validation
  error, so a malformed call is never executed without explicit consent.
- Custom tools: cap captured stdout/stderr at `BASH_MAX_OUTPUT_BYTES` while
  streaming, with a truncation notice placed at the head of the result, so a
  large-output tool can't exhaust memory before the final truncation runs.
- Custom tools: on timeout, the shell is spawned detached (Unix), the whole
  process group is signalled, and the tool call settles immediately instead of
  waiting for a `close` event that a surviving descendant may leave un-fired —
  killing both the infinite-hang and orphaned-process failure modes.