# Nanocoder code review - v1.30.0 → HEAD (03cc04d1)

Review of 474 commits / 756 files / +75,701 lines, weighted toward the new and security-sensitive subsystems: skills install, lifecycle hooks, the OS sandbox, `fetch_url` SSRF guards, path containment, the VS Code companion auth, the approval queues, semantic memory, checkpoints, and the ripgrep search rewrite.

## Status: all ten findings fixed

Every finding below has been fixed and committed to `main`, one commit each, with a changeset and regression tests. The commits are listed at the end.

Gate status after the fixes:

- `tsc --noEmit`: clean
- `biome check source plugins/vscode/src`: clean, 524 files
- `knip`: clean (configuration and tag hints only)
- `pnpm run build`: succeeds; `node dist/cli.js --version`, `--help`, `completion zsh`, `config list`, `daemon status` all run
- `pnpm run test:ava`: green (was red on finding 1)

Findings are ordered most severe first. Each one says what I verified and how, then what the fix was.

---

## 1. [blocker] The test suite is red on `main`

`source/tools/execute-function.spec.ts:29`, `:42`, `:55`

`77d7b8d3` ("report a non-zero shell exit as an error through processToolUse") changed `execute_bash`'s execute function to return a `StructuredToolOutput` (`{llmContent, isError}`) instead of a plain string. It updated its own spec (`source/tools/execute-bash.spec.tsx`) but not `execute-function.spec.ts`, which calls the same execute function and casts the result `as string`.

Failure: `t.regex()` must be called with a string. Called with `{isError: false, llmContent: "EXIT_CODE: 0\ntest\n"}`.

The `as string` cast at `execute-function.spec.ts:26`, `:39` and `:52` is exactly why `tsc` stayed green: the cast asserts away the type change, so the compiler could not flag it and only the runtime assertion caught it.

Reproduce:

```
pnpm run test:ava source/tools/execute-function.spec.ts
# 3 tests failed
```

Fix: read the model-facing text through the same helper `execute-bash.spec.tsx` now uses, and drop the `as string` casts so a future shape change fails at compile time rather than at assert time.

This is not a product defect - the production paths (`message-handler.ts:96-104`, `subagents/subagent-executor.ts:867`, `commands/update.tsx:103`) all handle both shapes correctly. But a red suite on the release commit should block the tag.

---

## 2. [high] Command injection through the skill install `ref`

`source/skills/install.ts:332` and `:340`

`cloneAtRef` falls back to `git init` + `git remote add` + `git fetch origin <ref>` when `git clone --branch <ref>` fails. The `ref` is passed as a positional argument with **no `--` terminator**, so git parses a `ref` that begins with `-` as an option. `--upload-pack=<cmd>` makes git execute `<cmd>` through a shell.

Verified locally:

```
git init -q src && git -C src commit -q --allow-empty -m x
git init -q dst && git -C dst remote add origin -- ../src
git -C dst fetch --depth 1 origin "--upload-pack=sh -c 'echo REF_INJECTION > /tmp/refpwn.txt'"
# fatal: Could not read from remote repository.
cat /tmp/refpwn.txt
# REF_INJECTION      <- the command ran
```

Both reachable entry points feed this:

- `nanocoder skills add <repo> --ref '--upload-pack=...'` - user-supplied, so lower impact, but the `--branch` attempt fails first and guarantees the vulnerable fallback runs.
- An index entry's `ref` (`source/skills/install.ts:249`). The index is remote JSON (`skills.json` on GitHub raw by default, or wherever `NANOCODER_SKILLS_INDEX` points). Nothing validates it beyond `typeof repo === 'string'` at `:215-219`. A compromised index, a malicious `NANOCODER_SKILLS_INDEX`, or a typosquatted entry executes a command **before the trust prompt is ever rendered** - which defeats the entire staged design described in that file's header comment.

Related, same function: `entry.repo` is equally unvalidated at `:246` and goes to `git clone -- <repo>`. `--` does stop option parsing, but it does not stop git's remote-helper transports. `ext::sh -c '...'` is the classic case:

```
git -c protocol.ext.allow=always clone --depth 1 -- "ext::sh -c 'echo X > /tmp/pwn2.txt'" ./c
# the shell clearly runs
```

On stock git 2.50 this is blocked (`fatal: transport 'ext' not allowed`, since `protocol.ext.allow` defaults to `never`), so it is not exploitable by default today. It is exploitable on any machine that has relaxed `protocol.*.allow`, and relying on a git default for a security property the code claims to own is fragile.

Fix:

- Add `--` before `ref` in both `fetch` calls, or reject any `ref` starting with `-`.
- Validate `entry.repo` against an allowlist of schemes (`https:`, `ssh:`, `git@`, plain local path) before it reaches `git`, rather than accepting any string.
- Consider setting `GIT_PROTOCOL_FROM_USER=0` / `-c protocol.ext.allow=never` explicitly in `GIT_ENV` so the behaviour does not depend on the user's git config.

---

## 3. [medium] Custom-command variable substitution expands `$` tokens and can throw on the parameter name

`source/custom-commands/parser.ts:303-304`

```ts
const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
result = result.replace(pattern, value);
```

Two separate defects on two lines.

**The replacement is a substitution template, not a literal.** This is the identical bug that `fix-literal-replacement-dollar-tokens` fixed for `string_replace` and `diff_edit` this cycle; the custom-command path was not covered. Verified:

```
content = 'Prefix TEXT {{args}} SUFFIX TEXT'
value   = "use $' here"
result  = "Prefix TEXT use  SUFFIX TEXT here SUFFIX TEXT"   // $' spliced the rest of the template in
value   = "cost $& done"
result  = "Prefix TEXT cost {{args}} done SUFFIX TEXT"       // $& expanded to the match
```

So `/mycommand "use $' to quote"` silently sends the model a mangled prompt with a chunk of the template duplicated into it. `$$`, `` $` `` and `$&` all misbehave the same way. Arguments are user-typed, so this is a correctness bug rather than a privilege issue, but it is silent and the user never sees what was actually sent.

**The key is interpolated into a regex unescaped.** A parameter name containing a regex metacharacter builds a wrong pattern, or throws:

```
new RegExp('\\{\\{\\s*' + 'a(b' + '\\s*\\}\\}', 'g')
// SyntaxError: Invalid regular expression: Unterminated group
```

That is an uncaught throw on the command path for a parameter name the author is free to write in their own frontmatter.

Fix: use a replacer function (`result.replace(pattern, () => value)`), which is exactly what `source/custom-tools/template.ts:87-93` already does correctly for custom tools, and escape `key` before building the pattern.

---

## 4. [medium] Lifecycle hook output is decoded per chunk, so multi-byte UTF-8 is garbled

`source/services/lifecycle-hooks.ts:398-402`

```ts
const capture = (current: string, chunk: Buffer): string => {
  const remaining = MAX_HOOK_OUTPUT_CHARS - current.length;
  return remaining <= 0 ? current : current + chunk.toString().slice(0, remaining);
};
```

`chunk.toString()` decodes each chunk in isolation. A multi-byte character split across a pipe boundary becomes two U+FFFD replacement characters. This is the same bug `utf8-chunk-boundary-fix` closed for bash and custom tools this cycle by routing both through `source/utils/stream-collector.ts`, which holds an incomplete tail back in a `StringDecoder`.

Confirmed by grep: `stream-collector` is imported by `source/custom-tools/handler.ts:13` and `source/services/bash-executor.ts:25` only. `lifecycle-hooks.ts` was missed.

It matters because hook stdout is not cosmetic. `pre-tool-use` and `user-prompt-submit` stdout goes back to the model as the veto reason, and `post-tool-use` stdout is folded into the tool result - so a formatter or linter emitting non-ASCII (box-drawing output, CJK paths, emoji status markers) can feed the model corrupted text.

Secondary, same lines: `.slice(0, remaining)` slices a decoded string by code units, so the cap can also cut a surrogate pair in half.

Fix: use `makeStreamCollector` here too, and call `flush()` on `close`.

---

## 5. [medium] Hook timeout sends SIGTERM to the process group but never escalates

`source/services/lifecycle-hooks.ts:341-373`

`killHookTree` signals the group with `process.kill(-pid, 'SIGTERM')` and returns. The SIGKILL on line 369 only runs in the `catch`, i.e. when the group was already gone - the opposite of the case that needs it. A hook that traps or ignores SIGTERM survives its own timeout.

Compare `source/custom-tools/handler.ts:73-90`, where the same class of bug was explicitly fixed this cycle (#1141): that path destroys the stdio pipes, signals the group, and then arms a separate un-cancelled SIGKILL escalation timer targeting the group, with a comment spelling out why. Hooks have neither the escalation nor the pipe destruction.

The practical consequence is milder than for custom tools, because `finish()` resolves on the timeout regardless, so the session is not wedged - but the runaway process tree is left running, which is the specific thing the changeset says the detached spawn exists to prevent.

Fix: mirror the custom-tool escalation - destroy `proc.stdout` / `proc.stderr`, then arm a grace timer that sends `SIGKILL` to `-pid`.

---

## 6. [medium] The semantic-memory file lock can be stolen from a live holder

`source/memory/semantic-memory-manager.ts:47-91`

`withExclusiveLock` is an `O_EXCL` lockfile with a 10-second staleness window (`LOCK_STALE_MS = 10_000`). A waiter that finds the lock file older than 10 seconds `unlink`s it and takes the lock:

```ts
const stat = await fs.stat(lockPath);
if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
  await fs.unlink(lockPath);
  continue;
}
```

Two problems:

- The mtime is stamped once at acquisition and **never refreshed** while the holder works. Staleness therefore measures "how long the lock has been held", not "whether the holder is alive". Any operation that legitimately takes more than 10 seconds has its lock reclaimed out from under it by a waiter in another process, and the two then run the critical section concurrently. Both end with `atomicWriteFile`, so the loser's memories are silently lost rather than merged.
- The holder's own release path (`:63-70`) reads the lock file and only unlinks it if the recorded pid matches, which is correct and does prevent a *second* theft - but by then mutual exclusion has already been broken once.

The in-process `enqueueByKey` serialisation at `:34-45` means this only bites across processes (two TUI sessions, or a TUI plus the daemon, in the same repo - which is exactly the scenario `semantic-memory-remaining` set out to support).

Fix: record the pid *and* refresh mtime periodically while held, or check `isProcessAlive(pid)` on the recorded owner before reclaiming rather than trusting elapsed time alone. `source/vscode/discovery.ts:126` already has an `isProcessAlive` helper that does exactly this for the discovery file.

---

## 7. [low-medium] `fetch_url` issues every request twice

`source/tools/fetch-url.tsx:22-57` and `:63-72`

`resolveSafeRedirects` walks the redirect chain with `redirect: 'manual'`, and when it reaches a non-redirect status it returns that URL - but it has already **fetched the body** of the final response and then throws it away (`response.body?.cancel()` at `:54`). `executeFetchUrl` then hands that same URL to `convertToMarkdown`, which fetches it again.

So every `fetch_url` call makes at least two full GETs of the target: doubled bandwidth, doubled rate-limit consumption, and two hits on any endpoint that logs or meters requests. On a slow page it also roughly doubles the tool's latency, inside a 15-second timeout budget that applies to the probe only.

The design rationale (validate each hop, then fetch with redirects off) is right; the probe just does not need to be a GET of the final resource. Using `HEAD` for the hop walk, or having `convertToMarkdown` accept an already-fetched body, would collapse it to one request.

Unchanged-and-fine, for the record: the guard itself (`source/tools/fetch-url-guard.ts`) is sound. I checked the numeric-host bypasses (`http://2130706433/`, `http://0x7f000001/`, `http://127.1/`, `http://017700000001/`) and WHATWG `URL` normalises every one of them to `127.0.0.1` before `isBlockedFetchHost` sees it, and `[::ffff:127.0.0.1]` serialises to `[::ffff:7f00:1]` which the hex branch at `:47` catches. DNS rebinding remains the documented open gap.

---

## 8. [low-medium, needs confirmation] The approval queues have no drain path on abort

`source/app/hooks/useGlobalHandlerQueues.tsx:47-79`

The FIFO added by `fix-concurrent-approval-queue` is advanced in exactly one place - the callback returned at `:75-78`, driven by a user answer. Nothing drains the queue when a turn ends by any other route.

`tool-executor` can start up to `MAX_CONCURRENT_AGENTS` subagents that each push a request. If the user answers the head and then the turn is torn down some other way (Ctrl+C, a thrown error in the parent loop, a provider failure), the remaining entries are still in `queueRef.current` with unsettled promises, and `presentRef.current(queueRef.current[0]?.input ?? null)` will put a prompt from the *cancelled* turn back on screen.

Escape does work for the common case, because `ToolConfirmation`'s `useInput` handler calls `onCancel` which advances the queue - but it cancels one prompt per keypress, not the batch.

I did not reproduce this, so treat it as a hypothesis with a concrete test rather than a confirmed defect. Repro to try: dispatch 3 subagents that each need approval, answer the first, then interrupt the parent turn without pressing Escape again, and check whether a stale prompt appears or a subagent promise is left pending.

If it holds, the fix is an explicit `drain(result)` on the slot, called from the same place that aborts the turn.

---

## 9. [low] Discovery-file staleness relies on PID liveness alone

`source/vscode/discovery.ts:126-148`, used at `:221`

`isProcessAlive` is a correct `kill(pid, 0)` probe, including the deliberate EPERM-means-alive handling. But PIDs are reused. A discovery file written by a crashed CLI whose PID has since been recycled by an unrelated process reads as live, so the extension will try to connect to a port that is either closed or owned by something else, and `clearDiscoveryFile(path, expectedPid)` at `:253-263` will decline to clean it up.

Low impact (the connection simply fails, and the next `start()` overwrites the file), but `startedAt` is already recorded and unused - an age bound alongside the PID check would close it.

The rest of the companion auth work is solid: ephemeral bind, 256-bit token, header-not-query, constant-time compare with a length-independent dummy path (`:300-311`), `Origin`-header rejection, and mode 0600 with an atomic temp-file rename.

---

## 10. [low] A permanently disabled test

`source/app/components/settings-tabs.spec.tsx:607`

```ts
test.skip('scroll indicator appears when items exceed the visible window', ...)
```

Unlike the other four `test.skip` uses in the tree, this one is not platform- or CI-conditional - it is disabled outright, so the settings scroll indicator has no coverage. Given `/settings` gained several new panels this cycle (Notifications, Semantic Memory, Professional Tone, Alternate Screen, Mouse Reporting, Tool Results and Thinking), that window is more crowded than it was. Either fix it or record why it cannot run.

---

## 11. [info] Two accepted risks worth re-reading before you tag

Both are documented by the changesets themselves, not discovered here, but they are the two most likely to generate release-day reports.

**Unknown-tool calls are now sent to providers.** `configurable-retry-limits` retains a tool call naming a nonexistent tool in the assistant message's `tool_calls`, so the paired `Unknown tool: X` result is not orphaned and pruned. The changeset states the consequence plainly: "providers now receive a tool call naming a tool that was not in the request's tool list." That applies to all three runtimes including the ACP loop. Worth an explicit test against every configured provider - a strict validator returning 400 here would look like a total breakage rather than a retry-path edge case.

**ACP sub-agent approvals have three named limits.** From `acp-subagent-tool-permission`: the approval slot is a process-wide singleton, so with two ACP sessions mid-turn the later handler answers the earlier session's approvals against the wrong session id and abort controller; an approved sub-agent call is marked `completed` at approval time rather than at completion, so a client shows `completed` for a tool that may still fail; and sub-agent approvals ignore the ACP session's mode and `alwaysAllow`, so a `yolo` session still prompts inside a sub-agent. These are shipping as known limits - make sure the release notes say so rather than leaving users to find them.

---

## What held up well

Worth recording, because these are the areas I went looking for bugs in and did not find them.

- **Path containment** (`source/utils/path-validation.ts`). The filesystem-root fix for #1240 is done properly: `isPathInside` only appends a separator when the root does not already end in one, so `/` and `C:\` work without weakening the sibling-prefix guard. The `realResolvedPrefix` helper correctly symlink-resolves the existing prefix of a not-yet-created path, and the Windows-drive-path check at `:74` catches `C:\` on POSIX where `path.isAbsolute` would not.
- **The stream collector** (`source/utils/stream-collector.ts`). Per-stream budgets, a `StringDecoder` for chunk boundaries, and a deliberate decision to drop the held-back bytes on a truncated stream rather than park a stray U+FFFD after the marker. The reasoning is written down where the next person will find it.
- **ripgrep error handling** (`source/utils/file-search.ts:400-460`). Explicitly no stderr allowlist, with the rationale stated: anything unenumerated would fall through to `resolve('')` and every caller would read that as "no results". Exit 2 with partial output is kept; exit 2 with nothing is a hard failure. `setEncoding('utf8')` means it has no chunk-boundary problem.
- **The sandbox plan** (`source/services/bash-sandbox.ts`). Errors rather than silently degrading on every unsupported path, probes bwrap's ability to unshare the net namespace before committing, and caches that probe. `jailTmp` is unconditionally created whenever `sandbox && !isWindows`, so the `input.tmpDir ?? ''` fallback at `:194` that would produce a broken `--bind '' ''` is unreachable.
- **`processToolUse`'s structured-output handling** (`source/message-handler.ts:96-124`). Distinguishes structured from plain by `'llmContent' in result` rather than by `typeof`, passes a structured payload through untruncated, and only sets `isError` when the handler actually reported it.

---

## Fixes

Ten commits on `main`, one per finding, each with a changeset and regression tests.

- `f7a4bb6a` `test(tools): read execute_bash's structured output in execute-function.spec` — finding 1. Suite is green again. The `as string` casts are gone from the `read_file` cases too, so the next return-shape change fails at compile time rather than at assert time.
- `95d012fc` `fix(skills): stop a repo or ref reaching git as an option in skills add` — finding 2. `--` on both `git fetch` calls, plus a ref/repo allowlist at the single boundary every git-invoking path passes through. Four regression tests, each asserting the payload did not run rather than only that the install was refused. Verified by mutation: reverting both layers makes the two ref tests fail.
- `ff6333bd` `fix(custom-commands): insert template values literally, escape the key` — finding 3.
- `7c3ae683` `fix(hooks): decode hook output across chunk boundaries` — finding 4.
- `a81f29e8` `fix(hooks): escalate a timed-out hook to SIGKILL` — finding 5. Verified by mutation: disabling the escalation makes the test fail with `hook pid N outlived its timeout`.
- `4fe4c0bf` `fix(memory): decide lock ownership by liveness, not elapsed time` — finding 6.
- `6f8f2a46` `perf(tools): probe fetch_url redirect hops with HEAD, not GET` — finding 7.
- `428c0850` `fix(app): release queued approvals when the turn is cancelled` — finding 8, after confirming it.
- `869249b1` `fix(vscode): honour the discovery file's schema version` — finding 9, with a deliberate non-change recorded.
- `d09fedf0` `test(settings): re-enable the scroll indicator test` — finding 10.

Three of these are worth reading the commit message for, because the fix is not what the finding first suggested.

**Finding 8 was a hypothesis, and it was confirmed before anything changed.** The abstract claim ("no drain path") was not quite the defect. The real one is narrower and verifiable: `subagent-executor.ts` had the turn's `AbortSignal` in scope for the tool handler and did not pass it to `signalToolApproval`, so that await was the one place a subagent could not be cancelled. The #1156 changeset had already noted this ("parked in an await that is not abort-aware") without fixing it. The three slots now accept a signal; an aborted request leaves the queue and settles with the slot's existing safe fallback, which for both approval slots is *denied* — cancelling a turn can never be a route to approving a tool the user was not shown.

**Finding 9's suggested fix was rejected as net-negative.** The review proposed an age bound alongside the PID check. That would trade a self-healing transient (a recycled PID reads as live, the connection fails, the next `start()` repairs the file) for a worse failure: disconnecting a genuinely long-lived session. What was actually wrong in that file was adjacent and concrete — `version` was parsed and echoed back but never compared, so the "bump on breaking changes" its constant promises was inert and a future `v2` file would have been consumed as a `v1`. That is fixed; the PID residual is documented with the reasoning instead.

**Finding 10's skip reason had silently expired.** The test was disabled because no settings tab exceeded the four visible rows. This cycle Appearance gained Alternate Screen and Mouse Wheel Reporting with the fullscreen TUI (5 rows), and Behavior and Advanced reached 6 each. The precondition in the skip comment was simply no longer true.

One process note, since it bears on how much to trust the rest. While fixing finding 9 I replaced a block and dropped the `isProcessAlive` check along with it — silently removing the stale-detection guard. The existing test caught it immediately. That is the check working as intended, but it is also why every fix here ships with a test that fails on the original defect, and why findings 2 and 5 were additionally mutation-tested: a passing suite after a security fix only means something if you have watched it fail first.
