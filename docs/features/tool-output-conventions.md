---
title: "Tool Output Conventions"
description: "How file-content tools represent file contents in the responses they hand back to the model"
sidebar_order: 13
---

# Tool output conventions

File-content tools use different model-facing representations depending on what the model needs from the response.

## read_file

`read_file` returns raw file content without line numbers. This keeps the payload clean for content-based editing and makes it the canonical representation for exact text matching.

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
- `!command` input gets the capsule but never the re-run: you typed that command, so nothing else runs on your behalf.
- Output that is short enough to pass whole, and output that matches no known format, is unchanged.

## UI display

Line numbers rendered by the terminal or editor UI are presentation-only unless the tool intentionally returns a bounded, line-addressed excerpt.
