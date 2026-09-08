---
'@nanocollective/nanocoder': patch
---

Tool-execution safety fixes:

- Tool approval: never auto-approve a call whose arguments fail schema
  validation. The approval prompt now renders together with the validation
  error, so a malformed call is never executed without explicit consent.
  (Deliberate trade-off: a malformed approval-required call now costs the user
  a consent prompt where it previously self-corrected without one — the price
  of "nothing executes without consent".)
- MCP tools: the executed handler now runs the same lenient schema type-check
  the approval prompt shows, so a "wrong type" call is rejected locally before
  it reaches the server instead of relying on the remote validator alone.
- Custom tools: cap captured stdout/stderr at `BASH_MAX_OUTPUT_BYTES` while
  streaming, with a per-stream truncation notice appended to the affected
  stdout/stderr section (mirroring the bash executor), so a large-output tool
  can't exhaust memory before the final truncation runs.
- Custom tools: on timeout, the shell is spawned detached (Unix), the whole
  process group is signalled, and the tool call settles immediately instead of
  waiting for a `close` event that a surviving descendant may leave un-fired —
  killing both the infinite-hang and orphaned-process failure modes.
