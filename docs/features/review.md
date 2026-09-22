# Agentic Review

Nanocoder's review command verifies its findings. `/review` runs a
multi-agent pipeline: one agent hunts for issues by reading the actual code,
deterministic checks prune weak citations, and an independent agent verifies
each candidate before it reaches your report. Findings that do not survive
are shown as dropped, with the reason.

## Tiers

| Command | What runs | Best for |
| --- | --- | --- |
| `/review quick` | One-shot model pass over the diff | Fast feedback, small diffs |
| `/review` | Finder + citation gate + per-finding verification | Default choice |
| `/review deep` | Three specialist finders + dedup + verification | Larger or riskier changes |

All tiers accept the same target: a branch name, a PR number (requires the
`gh` CLI), or no argument to review the current branch against the default
branch.

## How the default tier works

1. **Finder.** A read-only subagent (`review-finder`) investigates the diff
   with a fixed tool set — `git_diff`, `git_log`, `read_file`,
   `search_file_contents`, `lsp_get_diagnostics` — under tool-call and turn
   budgets. It emits structured findings with file, line, severity, issue,
   and evidence.
2. **Citation gate.** Before any verifier is spent, each citation is checked
   against the repository: the file must exist, the line must be in range,
   and (when diff data is available) the line must fall in or near a changed
   hunk. Rejected citations are dropped with a note.
3. **Verification.** Each surviving finding goes to an independent verifier
   subagent that sees only the diff and that finding — never the finder's
   conversation. It returns CONFIRM, REJECT, or INSUFFICIENT with a reason,
   matched to the finding by ID.
4. **Report.** Confirmed findings appear sorted by severity. Everything else
   is listed under Dropped findings with its verdict and reason, so nothing
   silently disappears.

## The deep tier

`/review deep` runs three finder perspectives over the same diff — bugs,
standards and API misuse, and intent/spec — each independently budgeted.
Findings are deduplicated across finders by citation and textual similarity
before verification, so two finders chasing the same bug cost one verifier
run.

## Non-interactive use

`nanocoder review [quick|deep] [target]` runs the same tiers without the
terminal UI, so it works piped, redirected, or in CI:

```sh
nanocoder review > review.md
nanocoder review --output-format json 42 > review.json
```

All status traffic goes to stderr; stdout carries only the report (markdown)
or the JSON document. The JSON shape is:

```json
{
  "tier": "default",
  "target": "main...feature",
  "confirmed": [
    {"id": "F1", "file": "source/foo.ts", "line": 42, "severity": "high",
     "issue": "...", "evidence": "..."}
  ],
  "dropped": [
    {"id": "F2", "file": "source/foo.ts", "line": 7, "verdict": "REJECT",
     "reason": "guarded upstream"}
  ],
  "notes": [],
  "usage": {"finder": 812, "verifier": 340}
}
```

## Custom agents

Both review agents are registered programmatically, and user or project
agent definitions win: a `.nanocoder/agents/review-finder.md` with your own
prompt replaces the built-in. The runtime tool ceiling is enforced by the
executor regardless of what a custom definition requests.

## Notes and limits

- Usage numbers are approximate streamed-progress counts, not billing usage.
- A finder that hits its budget still contributes partial findings.
- The tier word (`quick`/`deep`) always wins as the first argument, so a
  branch literally named `quick` must be reviewed by its full ref.
