# Nanocoder release smoke test - everything since v1.30.0

Scope: 474 commits, 756 files, +75,701 / -6,843 lines, 168 pending changesets (36 minor, ~130 patch, a handful CI-only).

Baseline: `tsc --noEmit`, `biome check`, `knip`, `pnpm run test:ava` and `pnpm run build` are all green, and `node dist/cli.js --version` runs. The ten findings in `RELEASE-REVIEW.md` have been fixed and committed; the boxes below that reference them are now regression checks rather than known bugs.

How to use this: work top to bottom, tick each box. Anything marked **[blocker]** should gate the release; everything else is a quality check. Most checks need a real provider configured, so set one up first (`/provider`, or `agents.config.json`).

---

## 0. Pre-flight

- [x] `pnpm install && pnpm run build` succeeds from a clean `node_modules`
- [x] `node dist/cli.js --version` prints the new version
- [x] `node dist/cli.js --help` lists `architect` in the `--mode` values, and lists `config`, `completion`, `skills`, `review`, `daemon`
- [ ] `pnpm run test:ava` is green **[blocker]**
- [x] `pnpm run test:types`, `pnpm run test:lint`, `pnpm run test:knip` are green
- [x] Packed tarball smoke: `npm pack` then run `--version` from the unpacked tarball (the `release-pack-smoke` CI step does this; confirm it ran)
- [x] `schemas/agents.config.schema.json` is present in the published `files` list and `pnpm run generate:schema` produces no diff

---

## 1. Fullscreen TUI (the biggest behaviour change)

Interactive sessions now run on the alternate screen by default. This is the single change most likely to generate support noise, so test it on more than one terminal.

- [x] Launch `nanocoder` with no flags - it enters the alternate screen (your scrollback is untouched, the app repaints the whole window)
- [x] The prompt box is never pushed off-screen by a long turn; the transcript clips at the top instead
- [x] PgUp / PgDn scroll the transcript
- [x] Mouse wheel scrolls the transcript three rows per tick (not prompt history)
- [x] Resize the terminal mid-session - the frame repaints cleanly, no torn borders
- [x] Exit cleanly (`/exit`, Ctrl+C twice) - the terminal is restored: alternate screen off, mouse reporting off, alternate-scroll (DECSET 1007) restored
- [x] Kill the process hard (`kill -9` from another shell) and confirm how bad the terminal is left; `reset` should fix it
- [x] `--no-alt-screen` returns to inline mode; finished messages land in real scrollback
- [x] `/settings` → "Alternate Screen" toggle works and persists
- [x] `--no-mouse` disables wheel scrolling and restores native click-drag selection
- [x] `/settings` → "Mouse Wheel Reporting" toggle works
- [x] In fullscreen with mouse on, Shift+drag (Option+drag in iTerm2) still selects text
- [x] `nanocoder run "..."`, non-TTY and piped output never enter the alternate screen
- [x] Test on at least: macOS Terminal, iTerm2, and one Linux terminal (gnome-terminal / kitty / alacritty), plus tmux

### Welcome screen

- [x] At 80x24 the welcome screen fits: the last menu item and the tip are both visible
- [x] At >=90 columns the full `NANOCODER` block wordmark renders; below that the `NC` monogram
- [x] Version line, centered quick-action menu, and branch/directory line all present and centered
- [x] On a tall terminal the whole block is vertically centered
- [x] The subtitle is the project description, not "local-first coding agent"
- [x] The boot summary shows the **working directory** plus git branch, not the config file's directory
- [x] On a narrow terminal the boot summary keeps provider/model/mode on line one and drops workspace/branch underneath

### Paste and input

- [x] Paste a 3-line block - it arrives as one placeholder and does **not** submit partway through
- [x] The placeholder reads `[Paste #1: 3 lines]`, not a char count
- [x] Paste a long single line - label falls back to `[Paste #N: X chars]`
- [x] Paste the *same* text twice - both copies survive into the prompt
- [x] Paste with the cursor in the middle of existing text - the placeholder captures the pasted text, not a slice from the end
- [x] Create two pastes, delete the first, paste a third - the second placeholder is intact (no id reuse)
- [x] Backspace deletes the character **before** the cursor (this was broken on essentially every terminal)
- [x] Forward Delete still deletes forward
- [x] Undo/redo (readline editing) behaves after a fast burst of typing + undo
- [x] `@file` mention inserted then deleted with Backspace removes atomically, no orphan
- [x] Resume an old session whose history predates placeholders - a restored paste expands to its content, not its `[Paste #N]` label
- [x] Press `?` in an empty prompt - the keyboard shortcuts overlay opens; `?` or Esc closes it
- [x] Type a character first, then `?` - it inserts literally
- [x] Ctrl+T toggles the task list; the status-bar badge yields space on a narrow terminal rather than squeezing the session name

---

## 2. Architect mode (new 5th mode)

- [x] Shift+Tab cycles through normal → auto-accept → yolo → plan → architect (confirm the exact cycle matches `--help`)
- [x] `--mode architect` works; `nanocoder completion zsh` offers `architect` as a value
- [x] Architect auto-executes file-mutating tools, then opens a review gate before the turn ends
- [x] **Revert** deletes files the turn *created*, not just reverting edits
- [x] Revert covers `lsp_format_document` and custom file tools, not only `write_file` / `string_replace`
- [x] **Escape** keeps the changes (does not silently revert) and the footer says so
- [x] **Revert & Revise** sends the instructions you typed, verbatim
- [x] The composer is hidden while the gate is open - keystrokes cannot reach two components, and the gate cannot be bypassed
- [x] After a revert, the model is told its changes are gone (next turn does not edit against a stale view)
- [x] Checkpoints are released once the gate resolves (check the checkpoint list does not grow one per turn)

---

## 3. Lifecycle hooks

Configure a `nanocoder.hooks` block in `agents.config.json` and exercise each event.

- [x] `session-start` output is injected as context on the next chat prompt
- [x] `session-start` context is **not** consumed by a slash command or a `!` bash passthrough
- [x] `user-prompt-submit` exiting non-zero denies the prompt, stdout goes back as the reason
- [x] `pre-tool-use` exiting non-zero denies the tool **before** any confirmation prompt renders
- [x] `post-tool-use` output is folded into the tool result, including when the tool failed
- [x] `pre-compact` fires on `/compact` and on auto-compact
- [x] `session-end` fires and uses the shorter default timeout
- [x] A hook that hangs past its timeout is killed with its whole process tree and skipped, session continues
- [x] Hooks run from the project root even after the agent has `cd`'d elsewhere
- [x] `matchPaths` scopes a hook to the file a tool touched: `{"matchTools":["write_file","string_replace"],"matchPaths":["**/*.{ts,tsx}"],"command":"npx prettier --write \"$NANOCODER_FILE\""}`
- [x] A path-scoped hook does **not** fire for `execute_bash` (no file)
- [x] A root-anchored pattern (`src/**`) fires whether the model wrote `src/a.ts` or the absolute path
- [x] Hooks fire on every surface: TUI, `run`, `--plain`, ACP, subagents (the tool hooks) and TUI + `run`/`--plain` (session/prompt hooks)
- [x] `/doctor` lists the project's wired hooks
- [x] `nanocoder.hooks` is accepted by the JSON schema (no "unknown key" in the editor)
- [x] A hook printing non-ASCII output (emoji, CJK) in large volume renders correctly (fixed, finding 4)
- [x] A hook that traps SIGTERM is gone a second after its timeout, not left running (fixed, finding 5)

---

## 4. Skills

### `nanocoder skills add`

- [x] `nanocoder skills add owner/repo` shallow-clones, strips `.git`, lints, and shows a trust prompt
- [x] The trust prompt names **every** tool with its declared approval policy and **every** event subscription
- [x] Declining installs nothing
- [x] A bundle containing a symlink is refused
- [x] A bundle whose path resolves outside the clone (symlinked subdir) is refused
- [x] Installing over an existing skill requires `--force`
- [x] A bare name resolves through the index; `NANOCODER_SKILLS_INDEX` / `--index` override it
- [x] `--subdir` escaping the clone is refused
- [x] A local checkout path installs; a local git repo goes through the clone path (uncommitted files do not leak in)
- [x] `--ref` with a commit SHA works (falls back to init+fetch+checkout)
- [x] `--ref '--upload-pack=...'` is rejected, and the command in it does not run (fixed, finding 2)

### Subscriptions and the daemon

- [x] `nanocoder daemon start` **refuses** in an untrusted directory
- [x] `--trust-directory` bypasses for one run without persisting; `NANOCODER_TRUST_DIRECTORY=1` persists
- [x] `nanocoder daemon status` / `logs` / `stop` all work
- [x] `daemon logs` on a large log returns the tail without loading the whole file
- [x] `daemon logs` on a log holding one very long line still returns content (not a sliver)
- [x] `daemon logs` with multi-byte content returns the intended window size
- [x] Deeply nested project (socket path past 104 bytes on macOS): the daemon falls back to a hashed socket under the temp dir, and `daemon start` reports the path it actually bound
- [ ] A `file.changed` subscription with `docs/**` fires on Windows (path separators normalized)
- [x] A root-scoped pattern `*.md` does **not** match `sub/a.md`
- [x] A brace pattern `*.{ts,tsx}` fires
- [x] An unbalanced brace stays literal instead of throwing
- [x] Two subscriptions sharing one cron expression: unregistering one keeps the other firing
- [x] `confirm: true` on a subscription dispatches in `plan` mode, not `headless`
- [x] An unsupported `skill:<name>` subscription target errors clearly at load
- [ ] The `triggeredRunComplete` notification fires after a daemon-triggered run

---

## 5. Tools

### File editing

- [x] `string_replace` with `$`, `$$`, `$&`, `` $` ``, `$'` in the replacement writes those characters literally
- [x] The same for `diff_edit`
- [x] The bytes on disk match the diff that was approved (terminal and ACP)
- [x] `string_replace` / `diff_edit` / `write_file` **refuse** a PDF or DOCX path with a named reason
- [x] `write_file` overwriting an existing file shows a real added/removed diff in the confirmation preview
- [x] The same diff appears in the post-execution result, including in auto-accept / yolo
- [x] `write_file` to a brand-new file still shows the syntax-highlighted dump
- [x] A `write_file` overwrite deep in a large file skips long unchanged stretches and still shows the edit

### Output caps

- [x] `write_file`, `string_replace`, `diff_edit` and MCP tools cap at 20 lines with `… (+N more lines · /expand n)`
- [x] When the cap cuts a diff, the note says how many hidden lines are edits
- [x] `/expand <n>` prints one result in full, including one folded into a compact tally
- [x] `/expand` with no argument lists recent results

### Search

- [x] `find_files` matches `./src/**/*.ts` and `./package.json` (leading `./` stripped)
- [x] `./*.tsx` behaves exactly like `*.tsx`
- [x] `search_file_contents` shows `file:line` hits under the match count, capped at 20 lines
- [x] A failed search reports the failure instead of returning empty results
- [x] `.nanocoderignore` keeps files out of directory listings, file search and the explorer
- [x] `read_file` and `execute_bash` deliberately **ignore** `.nanocoderignore`
- [x] Checkpoints deliberately ignore `.nanocoderignore` (hidden files still snapshotted and restored)
- [x] A large ignored directory does not crowd real files out of results
- [x] On a machine with no `rg` binary available, search fails with a clear error rather than silently returning nothing

### Bash

- [x] A command exiting non-zero is reported as **failed** in `--plain --json` output
- [ ] The same command shows as failed over ACP (Zed, VS Code), not "completed"
- [x] The model still receives the same plain text
- [x] Noisy stderr no longer swallows stdout - each stream gets its own budget and truncation marker
- [x] Multi-byte UTF-8 output across a chunk boundary is not garbled
- [x] A compound command displays on separate lines
- [x] `git` / `gh` needing credentials fails after 60s rather than hanging the session
- [x] `showAgentBashOutput` preference (`/settings` → Behavior) shows agent command output on the card, compact or not, including failures
- [x] `!command` you type yourself always shows output regardless of the preference

### OS sandbox

- [x] `nanocoder.sandbox: true` on macOS: writes outside the project + temp dir are denied, network is denied
- [x] On Linux with bubblewrap: same
- [x] On Linux without bubblewrap, or without unprivileged user namespaces: a clear error, **not** a silent fall-through to unsandboxed
- [ ] On Windows: clear "not supported" error
- [x] `cd` inside a sandboxed command still updates the session cwd
- [x] Compilers / `mktemp` / `npm` that need a writable temp dir still work

### fetch_url

- [x] `http://localhost/...`, `http://foo.localhost/`, `http://127.0.0.1/`, `http://[::1]/`, `http://169.254.169.254/`, `http://metadata.google.internal/` are all refused
- [x] `http://2130706433/` and `http://0x7f000001/` are refused (URL normalization folds them to 127.0.0.1)
- [x] `http://localhost./` (trailing dot) is refused
- [x] `http://localhost.example.com/` is **allowed** (real host that merely contains the string)
- [x] A public URL redirecting to `http://169.254.169.254/` is rejected at the hop, not followed
- [x] The rejection happens in yolo / headless / subagent runs too, not only where the validator runs
- [x] The truncation warning shows a character count

### Other tools

- [ ] `lsp_format_document` formats through the language server and honours `.editorconfig` indent
- [ ] `read_file` with `metadata_only: true` renders the metadata layout with a "(metadata only)" marker and a token count from the full file
- [x] `metadata_only` on a directory or symlink still renders the metadata layout
- [x] `list_directory` with no path hides dotfiles
- [x] Custom tool `cwd` resolving outside the project (absolute, `${HOME}`, `../`, in-repo symlink) fails with `Custom tool cwd escapes the project directory`
- [x] A missing custom-tool `cwd` falls back to the project root
- [x] A custom tool that backgrounds a long-lived child is fully killed at its timeout, and the call settles
- [x] A custom tool with huge output does not exhaust memory; stdout and stderr each get their own budget
- [ ] Custom tools work on Windows (`cmd.exe /d /s /c`)
- [x] A tool call whose arguments fail schema validation is **never** auto-approved; the approval prompt renders with the validation error
- [x] An MCP call with a wrong argument type is rejected locally before reaching the server

---

## 6. MCP

- [x] `"enabled": false` on a server actually prevents connection
- [x] A server's `alwaysAllow` list applies in **normal mode only** and cannot override plan mode
- [x] Plan mode hides MCP tools that are not annotated `readOnlyHint`
- [x] Headless / daemon-triggered runs execute MCP tools unattended without "denied by the user"
- [x] `readOnlyHint` does **not** skip a confirmation prompt in normal mode
- [x] `readOnlyHint` does **not** skip an ACP checkpoint or join a parallel batch
- [x] `@` fuzzy-search lists connected servers' resources alongside local filenames; selecting one inlines its content
- [x] `/mcp:<server>:<prompt>` fetches the prompt fresh and sends it as the next turn, with positional args filled in
- [x] A server declaring neither resources nor prompts contributes none, no error
- [x] Disconnecting MCP keeps workspace custom tools, skill/bundle tools, and their `approval`/`read_only` metadata
- [x] `web_search` stays absent when no Brave Search key is configured
- [x] Project-level `.mcp.json` with a hardcoded credential warns; one using `$API_KEY` does not
- [x] `/settings mcp` offers the You.com template; empty API key builds the keyless free profile
- [x] Re-editing a wizard-built config (e.g. `you-paid`) re-opens the original template's form and keeps the bearer token

---

## 7. Conversation loop and retries

- [x] `nanocoder.retries` in `agents.config.json` is honoured: `maxRepeatedToolCalls` (3), `maxEmptyTurns` (2), `maxMalformedRetries` (2), `maxTruncatedTurns` (2)
- [x] Hitting the repeated-tool-call limit interactively **asks** whether to continue or stop
- [x] Non-interactive runs hard-stop
- [x] `--plain` applies the caps and hard-stops with a clear error
- [x] Setting a limit to `0` restores fail-fast
- [x] A call to a nonexistent tool counts toward the repeated-call streak
- [x] A subagent loop applies `maxRepeatedToolCalls` and names the setting on stop
- [x] A `--plain` run whose reply was cut off at the output-token limit is asked to continue, and does not exit `0` with a half sentence
- [x] A run whose whole deliverable was a tool call does not exit `0` having written nothing
- [ ] Verify with a strict provider that the now-retained unknown-tool `tool_calls` entry does not trigger a 400 - see `RELEASE-REVIEW.md` finding 11 (accepted risk, not fixed)

---

## 8. Context, compaction, usage

- [x] Auto-compact runs on `--plain`, ACP and subagent loops, not just the TUI
- [x] Auto-compact in the TUI actually fires (it silently no-opped after the shared-helper refactor)
- [x] Subagents honour `sessions.maxMessages`
- [ ] Display-only text (`_Cancelled by user._`, `**Error:** ...`, mode toasts, VS Code slash-command replies, ACP revert notices) renders in chat but is **not** sent to the provider
- [ ] A compacted session is not told it had errored
- [ ] Context-usage estimates and the auto-compact threshold count only what the provider receives
- [x] `--context-max 10kg` and `/context-max 128kb` are **rejected**, not silently parsed as 10 / 128
- [x] A value large enough to overflow to `Infinity` is rejected
- [x] Anthropic prompt caching: `/usage` and the per-response indicator price cache reads/writes at their own rates and show the cached token count
- [x] `"promptCaching": false` on the provider config opts out
- [x] `maxOutputTokens` on a provider entry raises the ceiling; `/tune`'s max-tokens control works again
- [x] On `sdkProvider: "anthropic"` with a non-Claude model id, replies are no longer cut at 4096
- [x] The `Nano (low-end hardware)` preset's `maxTokens: 2048` actually applies
- [ ] Two providers serving the same model name report different token counts (provider is in the cache key)
- [ ] The summariser's `... [truncated N chars]` notice fits inside the budget rather than overshooting it

---

## 9. Privacy scrubbing

- [x] With scrubbing on, a `cat .env` tool result is scrubbed before it leaves the machine
- [x] A `git diff` carrying a key is scrubbed
- [x] `structuredContent` from `lsp_get_diagnostics` / `write_tasks` is scrubbed leaf by leaf
- [x] Assistant `tool_calls` arguments are scrubbed, including on replay in later turns
- [x] Paths and URLs stay in the clear
- [x] A truncation boundary never lands mid-placeholder

---

## 10. Checkpoints, timeline, sessions

- [x] Checkpoint a workspace containing a PNG / `.vsix` / sqlite file, restore it, and `cmp` the bytes - they must be identical
- [x] A checkpoint that dropped files (unreadable, or over `MAX_CHECKPOINT_FILES`) names them at restore time
- [x] A file above the workspace is refused for snapshot and reported through `skipped`
- [x] In a `git init`ed repo with **no commits**, `git add .` then checkpoint - files are captured, not skipped
- [x] `git checkout --orphan` case likewise
- [x] `/checkpoint load` shows a windowed, filterable list; typing filters, the window scrolls, it shrinks on a short terminal
- [x] `timeline.json` survives a mid-save kill (write a large timeline, `kill -9`, reopen) - readers see the complete old or new index
- [x] `/resume` filters sessions by keyword; Backspace edits, arrows and Enter pick, Esc cancels
- [x] Session selector with **no** sessions dismisses only on Escape
- [x] The `saving` indicator appears in the status line on autosave
- [x] `.nanocoder/tasks.json` is no longer written; task state is session-scoped; `/clear` starts a fresh list; resuming restores tasks
- [x] Two concurrent sessions do not share one task list
- [x] Automatic session titles: a thin opening prompt gets a generated descriptive name after the first tool-running turn
- [x] A manual rename is never overwritten
- [x] `sessions.smartTitles: false` turns it off; `sessions.titleModel` / `titleProvider` point it elsewhere
- [x] Existing sessions get a one-time retitle on next autosave (expect a visible history reshuffle)

---

## 11. Commands

- [x] `nanocoder config list` shows every setting, its value, and the source file
- [x] `nanocoder config show <key>` shows the default and the values it beat
- [x] `nanocoder config diff` lists only what your files change, plus "Ignored values"
- [x] Verify the block-override behaviour it documents: set `autoCompact.threshold` in the project file and `autoCompact.notifyUser` globally - the global `notifyUser` must appear under "Ignored values"
- [x] `threshold: 200` displays as `95` (capped)
- [x] API keys show as `<redacted>`
- [x] All three accept `--json`
- [x] `nanocoder completion bash|zsh|fish` prints a script; a missing/unknown shell fails with usage
- [x] `eval "$(nanocoder completion zsh)"` then tab-complete a subcommand and `--mode` values
- [x] `/repomap` builds a map with a spinner, no LLM round-trip; `/repomap --tokens 4096` widens it
- [x] Python docstring contents are **not** reported as symbols
- [x] A repo with exactly `maxFiles` indexable files is not reported as truncated
- [x] `/stats` shows 7d / 3m / all-time (←/→), cumulative chart, peak day, streak, top provider·model pairs
- [x] `/review` and `nanocoder review` produce a review of the branch diff / a PR
- [x] `/copy code` in the terminal copies the last fenced block; says "No code blocks found in the last response." when there are none
- [x] `/tip` shows a tip; `/tip <text>` narrows; consecutive runs do not repeat
- [x] `/explorer` opens without crashing, and picking files inserts them as `@` mentions on exit
- [x] `/export` auto-names the file descriptively; `~` and paths outside the project root are refused with a specific reason
- [x] Exported markdown with tool output containing inner code fences renders correctly (dynamic fence length)
- [x] `/help` does not crash
- [x] `/doctor` reports the real version, not `0.0.0`
- [x] `/status` Git line shows the `(default)` marker; the boot summary does not
- [x] `  /help` with leading whitespace **runs** rather than being sent to the model, and does not fire `user-prompt-submit`
- [x] `/init --preset react|nextjs|rust` seeds `AGENTS.md`, context ignores and a `/check` command skill, preserving existing files
- [x] `{{args}}` in a custom command with no declared parameters receives the raw arguments
- [x] **A custom command argument containing `$'`, `` $` ``, `$&` or `$$` reaches the model literally** - see `RELEASE-REVIEW.md` finding 3
- [x] An unreadable subdirectory under `.nanocoder/commands/` logs a warning and the scan continues

---

## 12. CLI flags and `run`

- [x] `--model=value`, `--provider=value`, `--vscode-port=value`, `--context-max=value` are honoured and stripped from the prompt after `run`
- [x] `--mouse` / `--no-mouse` are stripped from a `run` prompt
- [x] `nanocoder run --prompt-file <path>` reads the prompt from a file and takes precedence over a positional prompt
- [x] A missing/unreadable `--prompt-file` exits with a message rather than running an empty prompt
- [x] A ~300 KiB prompt via `--prompt-file` spawns on Linux (the argv form fails with `E2BIG`)
- [ ] A startup with a missing / malformed `package.json` falls back to version `unknown` instead of crashing

---

## 13. Notifications

- [x] macOS: a title or message containing newlines, quotes, backslashes or Unicode renders correctly
- [ ] Windows: same, with backticks and quotes
- [ ] `notifications.bell` writes BEL for enabled events; works over SSH and inside tmux (needs `monitor-bell`)
- [x] BEL is skipped when stdout is not a TTY
- [x] `/settings` → Notifications shows a row for `triggeredRunComplete`, and toggling any switch does not drop it
- [ ] Preferences are read from the top-level `notifications` and `paste` keys (not `nanocoder.notifications` / `nanocoder.paste`)

---

## 14. Rendering

- [x] Syntax highlighting follows `selectedTheme` in markdown code blocks, `string_replace` diff context, `write_file` preview, and the explorer preview
- [x] `"syntaxTheme": "dracula"` in `nanocoder-preferences.json` points code at that palette while the UI stays put
- [x] An unknown `syntaxTheme` falls back to `selectedTheme` rather than dropping styling
- [x] A markdown table with many columns fits the terminal and does not break its borders; one too wide is left as raw markdown
- [x] On an 80-column terminal the status bar ellipsises cleanly rather than being cut mid-word ("auto-accept mode o")
- [x] The live compact tool-activity summary shows at most 5 tool rows then `+N more`
- [ ] The streaming reasoning trace is fast in a long session; collapsed (the default) costs almost nothing
- [ ] A long conversation in fullscreen does not get progressively slower
- [x] Cycling modes fast with Shift+Tab does not stack identical `[mode → model]` toasts; returning to normal posts nothing
- [x] In inline mode a prompt does not appear twice in scrollback when streaming starts
- [x] Escape to recall an in-flight prompt in inline mode leaves the bubble in scrollback
- [x] Long user messages (>40 words / >300 chars) collapse for display; the original is recallable from input history
- [x] Every interactive surface (session selector, IDE selector, explorer, plan review bar, question prompt, tool confirmation) has the same rounded titled box at the same width
- [ ] The transcript and mode indicator line up with the prompt's left border
- [x] `professionalTone` in `/settings` → Behavior applies **immediately**: the completion note loses its adjective and the TONE section appears without a mode/model switch
- [x] Under the `nano` tool profile the TONE section uses the short variant

---

## 15. Concurrency and approvals

- [x] Ask the model to dispatch several subagents at once, each needing tool approval - prompts queue and present one at a time, every caller settles
- [x] Answering a prompt twice quickly (double Enter, Enter then Escape) does **not** silently approve the next queued tool
- [x] Escape during a batch of queued approvals frees the turn cleanly
- [x] Cancelling a turn with approvals still queued settles them as *denied* and clears the prompts (fixed, finding 8)
- [x] Queued prompts resume after a slash command and after manual `/compact`
- [x] Two concurrent sessions writing usage data do not corrupt the file
- [ ] `/memory` recall works in subagent and daemon runs; a repo memory file caps at 500 entries
- [x] `/settings` → Advanced → Semantic Memory toggle works and defaults on
- [x] Run two nanocoder processes against the same repo writing memories concurrently - no lost writes, no corrupt JSON (fixed, finding 6)
- [x] A memory write that takes longer than 10s keeps its lock instead of being overwritten by the other process (fixed, finding 6)

---

## 16. ACP and the VS Code extension

- [ ] `nanocoder --acp` works from Zed
- [x] The companion WebSocket refuses an upgrade with no `Authorization` header
- [x] It refuses an upgrade carrying any `Origin` header (try connecting from a browser tab)
- [x] It binds an ephemeral port by default and writes `<configDir>/vscode-server.json` with mode 0600
- [ ] The extension reads the discovery file for port and token
- [x] `--vscode-port` still works and still writes the discovery file
- [ ] `nanocoder.serverToken` lets a remote/SSH user paste the token manually
- [x] A stale discovery file (dead PID) is ignored
- [x] Two concurrent CLIs do not clobber each other's discovery file on shutdown
- [x] `ask_user` with 5 or 6 options succeeds over ACP
- [x] A sub-agent tool call raises a `session/request_permission` and is not silently denied
- [x] Sub-agent cards are prefixed and titled with the sub-agent, no id collision with top-level
- [ ] Known limits still present: the approval slot is process-wide (two concurrent sessions cross wires), an approved sub-agent call is marked `completed` on approval rather than on completion, and sub-agent approvals ignore the session mode and `alwaysAllow`
- [x] Overlapping ACP prompts do not corrupt turn state
- [x] Built-in slash-command replies are kept in persisted history for replay; command-only sessions are not saved

### VS Code panel

- [ ] Each turn's thoughts, tool calls, edit cards and task plan group into one collapsible work summary; the final answer stays visible
- [ ] The summary reports completed / stopped / failed duration and reopens for pending approvals
- [ ] A turn cancelled before any thought or tool call shows no duration indicator (not `0s`)
- [ ] Composer: model on the input row, approval mode on the gear, provider + mode in a Configuration popover, all button-style dropdowns
- [ ] Mode selector sits on the composer row with accessible labels
- [ ] Add Provider: dynamic provider and SDK preset dropdowns, 23 templates matching the CLI, multiple custom model names, theme CSS tokens present
- [ ] Created/modified files appear as dashed chips above the composer as edits land; clicking opens the file
- [ ] Chips survive sending a message, dismiss individually and via "Clear N changed files", scroll at fixed height
- [ ] A deleted file loses its chip; a rename moves it
- [x] `diff_edit` reports as an edit over ACP; `file_op` reports delete / move / edit rather than a generic tool call
- [x] Action timeline: click a prior mutating step and revert workspace + conversation to that point
- [ ] The timeline does not snapshot its own before-images, skips (rather than records) a checkpoint when the workspace scan is truncated, leaves binaries alone, reverts a whole assistant turn, validates paths read back from the index
- [x] "Retry" on an assistant turn truncates history at the matching user turn and drops timeline checkpoints inside it; no duplicate user bubble
- [ ] `nanocoder.showTokenUsage` defaults **off**; turning it on restores token + cost footers
- [ ] Reopening a saved chat restores token/cost footers (sessions without usage metadata load unchanged)
- [ ] Slash autocomplete: `/test`, `/explain`, `/doc` insert an editable template; `/clear`, `/copy` run as before; the menu only opens on a line-leading slash
- [ ] Welcome screen shows on a fresh panel and hides on session load / first message
- [ ] Subagent activity card shows `1.9k tokens`, not `1k`
- [ ] Message footer hides while streaming
- [ ] Auto-scroll does not yank you to the bottom while reading back; it does force-scroll on run finish and session load
- [ ] Theme colors render (Tailwind v4 `@theme` block)
- [ ] Editor-tab drag and drop, MCP settings button opening `.mcp.json`, and the denied-edit status icon all work
- [x] `pnpm run build:vscode` produces `assets/nanocoder-vscode.vsix`

---

## 17. Cross-platform

- [ ] **Windows**: models cache writes to the real home dir, not a literal `~` folder
- [ ] **Windows**: custom tools spawn `cmd.exe /d /s /c`
- [ ] **Windows**: `file.changed` subscriptions fire
- [ ] **Windows**: notifications handle special characters
- [ ] **Windows**: the OS sandbox errors clearly rather than pretending to work
- [ ] **Linux ARM**: search works on a ripgrep build without PCRE2
- [x] **Containers**: a workspace mounted at `/` passes path-containment checks (file tools and `search_file_contents` do not reject every path)
- [x] **macOS**: deeply nested project socket path fallback (section 4)

---

## 18. Regression sweep before tagging

- [x] Fresh install in an empty directory: trust prompt appears **before** any `agents.config.json` / `.mcp.json` is read or any stdio MCP server is spawned
- [x] Decline trust: nothing is read, nothing is spawned
- [x] `--trust-directory` skips the gate; initialization still runs exactly once afterwards
- [ ] A full end-to-end task on each of: Ollama, OpenRouter, Anthropic, a generic OpenAI-compatible endpoint
- [ ] The same task through `nanocoder run`, `--plain`, `--acp`, and a daemon-triggered skill
