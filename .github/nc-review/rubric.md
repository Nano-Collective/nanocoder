# nc-review rubric — Nanocoder

This is the **project** half of the rubric: what Nanocoder cares about. The
reviewing method — how to read a diff against a base checkout, how to rate
severity, what to emit — is the shared base rubric you were also given. Read
both; where they disagree, this file wins.

## Architecture

`CLAUDE.md` is the architecture document and is authoritative. The conventions
that come up most in review:

- **Tools** are registered in the tool registry, not wired ad hoc.
- **State** goes through `useAppState`, not component-local stores that
  duplicate it.
- **Commands** live in the lazy registry, so adding one must not pull its
  implementation into the startup path.
- The UI is **Ink**. A change that blocks the event loop, writes to stdout
  directly, or renders outside the component tree will misbehave in ways a unit
  test will not catch — say so.

## What counts as a public contract

Breaking any of these is `blocking` unless the PR is explicitly a versioned
break with a changeset to match:

- CLI flags and their semantics
- `agents.config.json` — the config schema, including defaults
- Tool interfaces exposed to models
- The session file format and `RunRecord`
- Anything exported from the package entry point, and the VS Code extension's
  contributed commands and settings

## Tests

New features **must** include passing tests; bug fixes should include a
regression test. Test files are `.spec.ts` / `.spec.tsx`, colocated with the
code they cover.

Two failure modes worth naming here, because both have shipped:

- A test that imports the new function and asserts nothing meaningful satisfies
  the coverage gate while proving nothing. Ask whether it would fail if the
  behaviour regressed.
- A test that *names* a failure path but never triggers it — capturing a
  function without substituting it, so the failure branch never executes. That
  has passed review here before.

Do not demand tests for docs-only, comment-only or config-only changes.

## Changesets

A user-facing change needs a changeset. A CI, chore or docs change does not, and
the repository records that deliberately with an empty changeset rather than
none — see `.changeset/coverage-drop-vs-base.md` for the shape.

The package name inside a changeset must resolve against the workspace. A wrong
name passes the file-presence check and then breaks `release-prepare` on every
subsequent push to `main`.

## Where duplicates cluster

Nanocoder carries the largest open PR queue in the collective, and genuine
duplicates are common. Before concluding a PR is novel, search the corpus of
open PRs in the context for the same symptom, not just the same file — two
contributors routinely fix one bug in different layers.

## Scope

This repository takes many first-time contributions. Small, undiscussed PRs are
how people start here, so weigh scope by whether the change is *justified*
rather than by whether it was pre-agreed, and prefer "this wants a conversation"
over "this should not exist".
