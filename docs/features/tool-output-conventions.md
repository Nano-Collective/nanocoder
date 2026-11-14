---
title: "Tool Output Conventions"
description: "How file-content tools represent file contents in the responses they hand back to the model"
sidebar_order: 13
---

# Tool output conventions

File-content tools use different model-facing representations depending on what the model needs from the response.

## read_file

`read_file` returns raw file content without line numbers. This keeps the payload clean for content-based editing and makes it the canonical representation for exact text matching.

- Files of up to 1500 lines are returned whole. Longer files return a 250-line preview with a hint to read further sections with `start_line` and `end_line`.
- `metadata_only: true` returns the file's size, line count, type, encoding and modification time without its content.

### Repeat reads

Reading the same path and line range again while the file is unchanged (same modification time and size) returns a one-line stub instead of the body:

```
[file: src/app.ts ... already in context, unchanged since last read (120 lines, 3456 bytes). pass start_line/end_line to read the body again.]
```

A symlink is compared by its target, so editing the target file makes the next read return the content again. The stub is only returned while the earlier body is still in the conversation the model sees: compaction, the message cap dropping that read, `/resume`, `/tune`, the config wizard, and in ACP `/clear`, a retry, a timeline revert or loading a chat from disk all reset it. Subagents keep their own record.

## Edit tools

Bounded edit-tool responses, such as `string_replace` and `diff_edit`, return partial file windows. Those responses should keep line numbers because the excerpt needs to be placed inside the larger file.

When an edit tool returns file content:

- Include a header such as `Updated file context (lines X-Y of N)`.
- Use absolute file line numbers, not window-relative offsets.
- Keep omission markers aligned with absolute line numbers.

## write_file

`write_file` deliberately returns no file content at all. The model supplied the content in the call arguments, so echoing it back only spends tokens on something the model already has. The response is stats only: whether the file was created or overwritten, plus line, character, and estimated token counts.

## execute_bash

`execute_bash` returns `EXIT_CODE`, then stderr and stdout, capped at 2000 characters. Long output keeps its head and its tail, since build and test tools print their summary at the end.

### Background jobs

Set `run_in_background: true` for a process that does not exit on its own — a dev server, a watcher, a database. The call returns as soon as the job has started (after roughly one second of output), and its result is a job handle rather than an exit code:

```
JOB_ID: 6f1c...
STATUS: running
COMMAND: pnpm dev
Use bash_output with this job_id to read more, or kill_bash to stop it.
STDOUT:
  VITE v5.4.0  ready in 312 ms
  ➜  Local:   http://localhost:5173/
```

- `bash_output` returns only the text produced since the previous read, so a chatty server does not resend its whole log. Its status line reports `running`, `exited with code N`, or how the job was stopped. The preview in the `execute_bash` result counts as the first read.
- `kill_bash` stops the job's whole process group and waits for it to exit. Read any final output with `bash_output` before killing if you need it.
- Background output goes through the same bounded collector as a normal command, so a job that floods stdout cannot grow memory without limit.
- Background jobs have no timeout and ignore the turn's cancellation: they are meant to outlive the turn that started them. They are stopped by `kill_bash`, when their session closes, or when Nanocoder exits.
- Starting a background job goes through the same approval and sandbox path as a normal `execute_bash`. Plan mode hides `execute_bash`, `bash_output` and `kill_bash` together.

### Failure capsules

A failing test run is the case that cap handles worst: each failure's detail is printed in the middle of the log, between the progress lines and the summary, so it is exactly what gets cut. When a command exits non-zero and its output is over the cap, Nanocoder checks it against the formats of Jest, Vitest, Mocha, AVA and `tsc`. If one matches, the model gets a failure capsule instead of the cut log:

```
EXIT_CODE: 1
FAILURE CAPSULE (jest): 2 failing. Distilled from 3514 characters of output; only the failures are kept.
Reproduce: npm test -- jest/auth.test.js -t 'refreshSession retries once on 401'
Re-ran it on its own: still fails (exit 1).

1) refreshSession › retries once on 401
   at jest/auth.test.js:7:35
   expect(received).toBe(expected) // Object.is equality
   Expected: 2
   Received: 1
...
Summary: Tests: 2 failed, 81 passed, 83 total
```

- Each failing test keeps its title, location, assertion message and expected/received diff. Passing tests, stack traces and code frames are dropped.
- `Reproduce` is the original command narrowed to the first failing test: its file plus the runner's name filter (`-t` for Jest and Vitest, `--grep` for Mocha, `--match` for AVA). Nanocoder runs it once, under the same sandbox and working directory, and reports whether the failure reproduces on its own. A narrow run that passes points at an order-dependent or flaky test. A narrow run that runs no tests, or exits non-zero without reporting a failing test, is reported as inconclusive rather than as a pass or a failure. Mocha never prints the test file, so it is taken from the first stack frame that looks like a test file (`*.test.*`, `*.spec.*`, or under `test/`, `tests/`, `spec/` or `__tests__/`); when the error is thrown in the code under test, the capsule shows both where it was thrown and which test file ran it.
- The command is only narrowed, and only re-run, when it is a plain invocation of the runner that printed the output: `jest`, `npx vitest run`, `pnpm exec mocha`, or a package script (`npm test`, `pnpm test:unit`) whose `package.json` body is itself a plain runner call. Pipes, `&&` chains, redirects and substitutions are left alone, so the re-run is always a subset of what already ran. `bunx` works like `npx` and `bun run <script>` like the other package managers, but `bun test` is bun's own test runner, whose output is not one of the recognised formats, so it is never narrowed.
- `tsc` errors are listed one per line; there is nothing narrower to re-run, so `Reproduce` is the original command.
- The re-run never repeats a package script's `pre`/`post` hooks (a build, a lint, a coverage upload). When the script has such hooks, npm re-runs it with `--ignore-scripts`, which skips only the hooks; pnpm, yarn and bun get no automatic re-run.
- `!command` input gets the capsule but never the re-run: you typed that command, so nothing else runs on your behalf.
- Output that is short enough to pass whole, and output that matches no known format, is unchanged.

## UI display

Line numbers rendered by the terminal or editor UI are presentation-only unless the tool intentionally returns a bounded, line-addressed excerpt.
