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
  it reaches the server instead of relying on the remote validator alone. MCP
  was the last registry path that bypassed `withValidation`.
- Custom tools: cap captured stdout and stderr while streaming, so a
  large-output tool can't exhaust memory before the final truncation runs.
  Each stream gets its own budget via the same collector the built-in bash
  executor uses (now shared in `source/utils/stream-collector.ts`), so a stdout
  flood can't silently swallow the stderr explaining why the tool failed.
- Custom tools: on timeout, the shell is spawned detached (Unix) and the whole
  process group is signalled, so a backgrounded descendant can no longer
  outlive the tool's timeout. The SIGKILL escalation now targets the group and
  deliberately outlives the shell's own exit, since the shell exiting does not
  mean its group is empty.
