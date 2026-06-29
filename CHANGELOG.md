# 1.28.1

- Added **image attachments on user messages**. Paste an image from the clipboard with **Ctrl+V** (via `osascript` on macOS, `wl-paste`/`xclip` on Linux, PowerShell on Windows), drag an image file into the terminal, or type a path - quoted, unquoted, and macOS backslash-escaped paths are all recognised, and `http(s)` URLs are left untouched. Attachments (PNG/JPEG/GIF/WebP, up to 10 MB) show above the input box and **Ctrl+X** removes the last one; references are stripped from the text and sent as image parts to vision-capable models. A missing clipboard tool now logs a debug breadcrumb instead of silently no-op'ing. Thanks to @ragini-pandey. Closes #572.

- Added **skill promotion and demotion**. Skills can now be promoted and demoted between project and personal scope, with a `--move` flag to relocate rather than copy the skill files.

- Fix: **slash commands now run with their arguments**. Once a space is typed after a slash command, the completion menu hides so Enter submits the full command with its arguments instead of selecting a completion and dropping everything after the command name.

- Fix: **the chat view no longer snaps to the bottom when a slash command completion menu opens**. The completion and file-suggestion menus now render inside the bounded input layout, so the container expands without disrupting the window height calculation that previously forced the history to scroll in smaller terminals. Thanks to @Dhirenderchoudhary. Closes #581.

- Fix: **empty frontmatter blocks are recognised** instead of leaking `---` markers into the body or throwing. `splitFrontmatter` now matches an empty block, and `extractRawFrontmatter` uses the shared `parseYamlObject` helper so an empty subagent frontmatter flows through to validation and surfaces a clear `name is required` error. Thanks to @Fadhlan. Closes #592.

- Fix: **`ask_user` unwraps label-as-key option objects**, so options expressed as a `{ label: value }` map render as readable choices.

- Fix: **surface real network errors instead of mislabeling them as context overflow**. A failed request from a network error is no longer misreported as exceeding the context window.

- Fix: **size MoE models by total parameter count, not active count**, when auto-resolving the tool profile, so mixture-of-experts models get the correct tune.

- Fix: **number formatting on the `/copy` command** output.

- Docs: clarified **MCP tool profile visibility** and documented the image-attachments feature. Thanks to @zerone0x. Closes #593.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder.

# 1.28.0

- Added **Agent Client Protocol (ACP) support**. Nanocoder can now run as an ACP agent (`nanocoder --acp`), exposing its conversation, tool-calling, and permission flows over the protocol so it can be driven by ACP-compatible editors and clients (Zed and others). New `source/acp/` module covers the agent, server, session, conversation loop, content conversion, capability negotiation, and permission handling. Thanks to @Avtrkrb. Closes #529. Follow-up work added the missing ACP docs, kept the parallel tool-execution loop in sync with the plain shell, and made `NANOCODER_MAX_TURNS` configurable (with a raised default) so long ACP and plain-mode runs are not cut short.

- Consolidated the **built-in tool surface from 33 tools down to 19** and added **automatic tool profiling**. Tasks collapse from four tools into a single TodoWrite-style `write_tasks` (replace-whole-list, no IDs for the model to juggle); file ops merge delete/move/copy/create_directory into one `file_op`; git shrinks from eleven tools to six (status/diff/log/add/commit/pr) with rarer operations going through `execute_bash`. A new `auto` tune profile - now the default - infers `full`/`minimal`/`nano` from the model's parameter count, so small local models automatically get the slim tool set and prompt while large/cloud models are unchanged. The resolved profile re-resolves live on model switch and is surfaced in the input indicator (e.g. `tune: nano (auto)`). `/usage` and the context indicator now rebuild from the live tune/mode/model with the profile-filtered tool count, so usage and context reporting are trustworthy. Roughly 6.3k lines removed.

- Added **structured tool results and single-source validation**. Tool arguments are now type-checked against each tool's JSON schema at the execution boundary (`schema-validate.ts`), so malformed model output returns a clear field-level error the model can self-correct from, instead of being coerced at the render layer. Validation runs through the single `withValidation` seam shared by both the native and XML-fallback execution paths, ahead of any per-tool validator. Approval policy is likewise centralised and the old global mode context removed, so the current development mode (including a mid-run switch) is honoured consistently across the main loop and subagents.

- Added **session resume with full history replay**. Resuming a saved session now replays the message and tool-call history into the chat view via a new `session-history-renderer`, so you pick up exactly where you left off with the conversation visible rather than an empty screen. Companion fixes resolved an autosave race, history-truncation, and resume edge cases, with regression coverage. Thanks to @akramcodez. Closes #545.

- Added the **`/copy` command** to copy the most recent assistant response to the system clipboard. Cross-platform via `clipboardy` (pbcopy / xclip / clip.exe), with a clear warning when there is no assistant message and a surfaced error when the clipboard write fails.

- Added **read-before-edit guards and tool-call loop detection for local models**. `string_replace` and `write_file` now require the file to have been read first, and a tool-signature tracker detects a model repeating the same tool call in a tight loop. Both make smaller local models materially safer to run unattended.

- Added a **skill linter** (`/skills check <name>` and a `check_skill` tool) that validates a bundle from disk with the same parsers the loader uses, so a PASS means it will load. It is wired into `/skills create` so the model verifies and self-corrects what it generates, and it lints member template bodies (unsupported mustache tags, unbalanced or unclosed sections, placeholders referencing undeclared parameters), not just frontmatter. Also added **optional command arguments**: inline defaults (`name=default`) and conditional sections (`{{# name }}`, `{{^ name }}`) in command bodies, plus inverted-section support in custom-tool templates via a shared section engine. Fixed subagents ignoring the development mode (the executor captured `normal` once at startup and never updated it).

- Added **Atlas Cloud** as a first-class provider and sponsor, with a wizard onboarding template and a dedicated provider docs page.

- Added the **Requesty** provider (https://requesty.ai) as a first-class OpenAI-compatible provider, mirroring the OpenRouter integration with a name matcher, app-attribution headers, a wizard onboarding template, and docs. Thanks to @Thibaultjaigu. Closes #589.

- Added **API-reported context usage** with an estimate fallback. The `ctx: NN%` indicator now reflects provider-accurate token counts when the model reports them (captured from the final step's `usage`, not the tool-loop-summed `totalUsage`), falling back to client-side estimation otherwise. Estimated figures are marked with a leading `~` (`ctx: ~42%`); API-reported figures render bare. Thanks to @JimStenstrom. Refs #381. Follow-up work anchored the API figure across turns, counted real tool definitions in the auto-compact gate, and added a tiktoken-based generic fallback tokenizer for more accurate counts on models without a native tokenizer.

- Added **git branch display** in the boot summary and `/status` panel, with a narrower-terminal-friendly rendering. Thanks to @ragini-pandey. Closes #539.

- Reworked **provider model discovery UX** in the wizard, surfacing real discovery errors instead of silently falling back, and showing model names in the selection list with long labels truncated by ellipsis. Thanks to @akramcodez and @Dhirenderchoudhary. Closes #554.

- Added **arrow-key navigation and highlighting for slash-command completion**. The completion menu now navigates with the arrow keys, with the double-submit-on-select bug fixed (TextInput ignores Enter; UserInput handles select-then-submit behind a guard flag) and `customCompletion` restored. Thanks to @rakshith1928. Closes #578.

- Added a **force-compact-and-retry fallback**. When the LLM server rejects a request for exceeding its context window, nanocoder now compacts and nudges the conversation to continue instead of failing outright. Thanks to @lordoski. Closes #546.

- Added **timeout, output limits, and abort support** to the bash executor, with regression tests covering the executor lifecycle. Thanks to @akramcodez. Closes #547.

- Custom display: **failed tool results condense to a one-liner in compact mode**. Generic `Error:` / `Validation failed:` results now render as a short red line (e.g. `write_file failed.`) in compact display mode, while the model still receives the full error in history and non-compact mode still shows it in full.

- Improved **`ask_user` prompt rendering**: dropped the leading `?` from the header, fixed spacing and the hanging indent, added arrow-key navigation, and normalised object-shaped options to readable strings (preferring a label over a value id).

- Improved **`@`-file-mention handling**: mention placeholders are kept in the chat instead of being expanded inline, and large-file inlining is capped to avoid blowing up the prompt.

- Fix: **Copilot GPT-5 reasoning streams** are now handled correctly via an `@ai-sdk/openai` patch and chat-handler changes, so reasoning content streams properly instead of breaking the response. Thanks to @EntropyParadigm. Closes #577.

- Fix: **propagate `AbortSignal` to streaming bash execution**, so cancelling a turn actually stops a long-running streamed command. Thanks to @Dhirenderchoudhary. Closes #550.

- Fix: **prevent silent overwrite of corrupted config files**. A corrupted `agents.config.json` no longer gets silently clobbered; the wizard now honours the `projectDir` prop for config-path resolution and the infinite render loop on the `existingProviders` default param is resolved, all with regression coverage. Thanks to @Dhirenderchoudhary. Closes #551, #552.

- Fix: **`read_file` returns an empty marker instead of throwing on empty files**, including range and metadata-only reads, with the `EMPTY_FILE_MARKER` constant extracted (later renamed `EMPTY_CONTENT_MARKER`) and tests for files containing only a newline. Thanks to @ragini-pandey. Closes #530.

- Fix: **prevent orphaned tool results from breaking LLM compaction**. A tool-aware boundary in the converter and summariser stops a recent-tail slice from splitting a tool-call group, which previously produced empty model output after compaction.

- Fix: **`/` key no longer scrolls the chat view to the bottom**. Thanks to @itsishant. Closes #590.

- Fix: **close the chokidar watcher if daemon startup throws**, and move the daemon stop-handler setup before resources start so a failed lockfile write calls `stop()` and cleans up. Thanks to @OMEE-Y and @rakshith1928. Closes #553, #557.

- Fix: replaced a stray `console.log` in `message-queue.tsx` with the structured logger. Thanks to @A-S-Manoj. Closes #588.

- Fix: added subagent context window overrides so delegated agents can run with a different context limit than the main session, and resolve provider names case-insensitively with custom CA bundle support for provider TLS. Thanks to @zerone0x.

- Added a `tmp >=0.2.6` override to resolve a path-traversal advisory in a transitive dependency. Thanks to @ragini-pandey.

- Large **refactor and dead-code sweep**: unified tool-call ID generation, extracted a shared `useWizardForm` hook, consolidated session-override managers, added message-factory helpers, deduped config loaders / git exec / command dispatch / conversation-loop flush, extracted `StyledSelectInput` and `makeSimpleToolFormatter`, and deleted several dead modules and orphaned exports (including `fetch-local-models` orphaned by an earlier removal).

- Updated the **Nanocoder Battlemap** competitive comparison and refreshed the README and docs.

- Dependency updates: `ai` 6.0.174 -> 6.0.193, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`, `@ai-sdk/anthropic`, `@agentclientprotocol/sdk` 0.22.1 -> 0.25.0, `undici`, `esbuild`, `@biomejs/biome` 2.5.0, `lint-staged` 17, `@types/node`, `@types/vscode`, and other transitive bumps tracked through the lockfile. Added `clipboardy ^5.3.1` for `/copy`.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder.

# 1.27.0

- Added **Skills**, a unified extension primitive that brings commands, subagents, and tools under a single ergonomic surface. Two forms over one primitive: **single-file** (a `.md` in `.nanocoder/commands|agents|tools/`, fully backwards-compatible with the existing flat dirs) and **bundle** (a directory under `.nanocoder/skills/<name>/` with `skill.yaml` plus optional `commands/`, `agents/`, `tools/` subdirs). Bundles are for multi-piece features that need to ship and version together: a bundle's subagent automatically gets its sibling tools, scoped tools are hidden from the global tool list (default for bundles, opt-in for single-file), and bundle commands auto-namespace (`commands/status.md` in bundle `git` invokes as `/git:status`). New `/skills` slash command lists everything loaded, and bundled members fan out into the existing `CustomCommandLoader`, `SubagentLoader`, and `ToolManager.registry` so downstream consumers keep using their familiar registries. Closes #515.

- Added **event-triggered skill runs** via a new per-project **daemon**. Skill members can declare `subscribe:` blocks in frontmatter (or a bundle manifest) and the daemon wakes them on `file.changed` and `schedule.cron` events. The daemon (`nanocoder daemon <start|stop|status|logs>`) runs as a long-lived background process with a lockfile, Unix-socket IPC, and installers for launchd (macOS) and systemd user units (Linux). The interactive TUI never starts event sources, so file watching and cron only run when you opt in. Triggered runs execute in a new internal **headless** mode (no `ask_user`, no foreground confirmations) which supersedes the legacy `scheduler` mode. Per-subscription `confirm: true` opts into `plan` mode instead. Backpressure caps per-subscription concurrency and trailing-debounces `file.changed` by 500ms so chatty save loops don't pile up.

- Removed the legacy `source/schedule/` module (`runner`, `storage`, `index`, `types`). Schedules are now expressed as `schedule.cron` subscriptions on a skill member and dispatched by the daemon. The old `useSchedulerMode` hook, `scheduler-view` component, and the `.nanocoder/schedules.json` / `.nanocoder/schedules/*.md` storage layout are gone. The `/schedule` command has been trimmed and refocused around the new model. Closes #524.

- Added **Custom Tools**: markdown-defined, model-callable tools that sit between custom commands (prompt injection only) and MCP servers (full external process). Drop a `.md` into `.nanocoder/tools/` (project) or `~/.config/nanocoder/tools/` (personal), declare parameters in YAML frontmatter (with JSON Schema-style `type`, `required`, `pattern`, `maxLength`, etc.), and write a shell command body using `{{ name }}` and `{{# section }}` template placeholders. All substitutions are shell-quoted to prevent injection. Includes `approval` (`always`/`never`) and `read_only` flags that participate in mode policy: plan mode requires `approval=never && read_only=true`, scheduler/headless requires `approval=never`. New `/tools create <name>` scaffolds a template and asks the model to help fill it in. Project tools shadow personal ones by `name`, and they register into the same `ToolManager` registry as built-ins and MCP tools so `/tools`, subagents, and mode filtering see them through a single unified registry. Closes #520.

- Added **LLM-based context compaction** as the default `/compact` strategy. The active model writes a structured markdown summary of the compressible segment (Context / Decisions / Files modified / Tools used / Open questions) using a dedicated summariser prompt, replacing the older messages with one synthetic summary while recent messages are kept verbatim. Higher fidelity than mechanical truncation at the cost of one extra round-trip. New `strategy` field in `autoCompact` config (`llm` default, `mechanical` legacy), new CLI flags (`--llm`, `--mechanical`, `--strategy <name>`), and automatic fallback to mechanical compression on LLM failure (network error, empty response, summary larger than original). Auto-compact uses the same strategy.

- Added **OpenRouter request configuration** via a dedicated `openrouter` block on the provider config. Forwards OpenRouter-specific request body fields (`provider` routing rules, `reasoning`, `plugins`, `models` fallback list, `service_tier`, `route`, `user`, etc.) on every request - always-on transport/routing concerns, not gated by `/tune`. Provider is detected by name (case-insensitive). `tune.modelParameters.reasoningEffort` populates `openrouter.reasoning.effort` when unset; explicit values on the provider config always win. Closes #519.

- Added **config lint** at startup. Surfaces common misconfigurations as warnings before they cause silent failures - e.g. an `openrouter` block on a provider that is not OpenRouter, unknown fields, type mismatches. Includes a full test suite. Closes #523.

- Reworked **OpenRouter model selection** in the provider wizard. Replaced the previous list with a paginated, searchable `ModelSelectionList` (12 visible items, page navigation, multi-select with running counter, select-all, error state). Makes browsing OpenRouter's hundreds of models actually usable from the wizard. Closes #516.

- Added **unified Session Service** for key generation and session infrastructure. Consolidates the various ad-hoc keying strategies scattered across commands, handlers, and tool result display into one place. Touched 50 files across handlers, commands, hooks, and the chat handler, removing duplicated key-derivation logic and shrinking `useAppState` by ~38 lines. Fully closes #229.

- Added the **Nanocoder Battlemap** - a long-form competitive comparison doc covering Nanocoder against Claude Code, OpenAI Codex CLI, Gemini CLI, Aider, OpenCode, Crush, and Pi across twelve axes (license, pricing, local-model support, MCP, extensibility, tool-calling, subagents, surface, plain mode, stars, contributors, telemetry). Honest where Nanocoder leads, honest where it does not. Closes #423.

- Made code blocks **copyable without ASCII artifacts**. Reworked the markdown parser and `AssistantMessage` rendering so fenced code blocks render as plain selectable text without surrounding box borders that previously got copied into the clipboard. Thanks to @aravindinduri.

- Fix: streaming OOM on long responses. `StreamingMessage` was calling `wrapWithTrimmedContinuations()` on the entire growing assistant message on every ~150ms flush, allocating per-line arrays proportional to the full message size. A ~37k-token (~150 KB) response would overwhelm GC and crash the 4 GB Node heap. Now slices the message to a bounded tail (`MAX_LINES * textWidth * 4` chars, snapped to a newline boundary) before wrapping, so per-render work is constant in the visible window rather than linear in total streamed content. Thanks to @abhishekDeshmukh74. Closes #526.

- Fix: performance entry buffer OOM in long sessions. React 19's `react-reconciler` (dev build) calls `performance.measure`/`performance.mark` on every render, and Node's built-in fetch (undici) pushes a resource-timing entry per HTTP request. Both write to the same global buffer, which nanocoder never drained. Over long subagent-heavy sessions the buffer accumulated millions of entries until V8 thrashed in mark-compact GC and crashed with `Ineffective mark-compacts near heap limit`. Fix installs an unref'd 30s interval that calls `performance.clearMarks()` / `performance.clearMeasures()` in the Ink render path. Thanks to @ragini-pandey. Closes #521.

- Fix: auto-compact ignored the per-provider `contextWindow` override. The auto-compact threshold was computed against the model's default context window even when the provider config narrowed it, causing compaction to fire late (or not at all) on providers configured with a smaller usable window. Closes #525.

- Fix: surface real provider errors instead of `[object Object]`. The error parser now extracts meaningful messages from AI SDK errors (status codes, body excerpts, nested `responseBody` fields) before they reach the UI, so model and API failures show up as actionable text instead of an opaque stringified object.

- Fix: removed dead MCP server hosts from the wizard templates. `remote.mcpservers.org` and a handful of other defunct discovery endpoints were still listed in `mcp-templates.ts` and would silently fail when selected. Companion dead-URL guard in `mcp-client` prevents the wizard from surfacing entries it cannot reach.

- Fix: markdown parser regressions in fenced code extraction. Indented fenced code blocks (e.g. inside list items) now extract correctly, fenced blocks nested inside blockquotes are no longer split out (they belong to the quote), and indented list continuations are preserved as list text instead of being misparsed as indented code. Removed indented-code extraction from the shared markdown parser entirely - only fenced blocks split out for copyable rendering.

- Fix: tightened the task management section of the system prompt to reduce over-eager task list creation on small jobs.

- Minor: nudged the system prompt to avoid markdown tables in output. Tables render poorly in the terminal even though the markdown converter supports them, so the model is now steered toward bullet lists or short prose.

- Fix: Nix packaging - reproducible pnpm 11 builds via `pkgs.pnpm_11` now that nixpkgs PR #505103 has landed. Drops the version-override scaffolding, the `chmod +x pnpm.cjs` postInstall hack, and the `manage-package-manager-versions` `replaceStrings` patch from the previous release. Also documents and works around an upstream `fetch-pnpm-deps` shell bug (`export VAR value` without `=`) that caused non-deterministic `v11/index.db` writes when `side-effects-cache` fell back to true. Re-enables the `update-nix.yml` workflow. Closes #511.

- Audit/security: updated `pnpm-workspace.yaml` `auditConfig` and `minimumReleaseAgeExclude` entries to align with the versions resolved in the lockfile, keeping `pnpm audit` output meaningful. Thanks to @aravindinduri.

- Chore: added `FUNDING.yml` linking the repo to Open Collective with a custom URL pointing at the `/sponsor` page.

- Dependency updates: added `chokidar ^5.0.0` for the daemon's file-watcher event source, plus assorted transitive bumps tracked through the lockfile.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder.

# 1.26.1

- Bumped `@nanocollective/get-md` to `^1.4.0`, which makes `node-llama-cpp` an optional peer dependency. Drops the entire `node-llama-cpp` transitive — including ~500 MB of platform-specific native binaries (CUDA, Vulkan, Metal, ARM variants) that pnpm fetched eagerly regardless of host — from the install graph and the Nix closure. The `fetch_url` tool (the only consumer of get-md) uses the standard HTML→Markdown path which doesn't need the LLM converter, so there's no functional change.

- Patched `flake.nix` for pnpm 11 compat. Overrides nixpkgs's bundled pnpm (currently 10.x) to pnpm 11.0.9 to match `packageManager`, then handles two pnpm-11-specific quirks: `chmod +x` on `bin/pnpm.cjs` (a Corepack-compat shim shipped without the execute bit by upstream) and a `replaceStrings` patch on `fetchPnpmDeps`'s `installPhase` to skip the now-rejected `pnpm config set manage-package-manager-versions false` global write. Unblocks the `update-nix.yml` workflow that's been failing on `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.

# 1.26.0

- **BREAKING**: Removed redundant `nanocoderTools.alwaysAllow` setting. It duplicated the top-level `alwaysAllow` with no extra behaviour. Move any entries from `nanocoderTools.alwaysAllow` to the top-level `alwaysAllow` array in `agents.config.json`. The deprecated `agents.config.example.json` has also been removed.

- Added **nano mode** — a third tool profile under `/tune` designed for the smallest open-weights models or low-end hardware running larger models locally. Strictly more aggressive than `minimal`: drops `find_files`, `list_directory`, and `agent`; trims `CORE PRINCIPLES` and `CODING PRACTICES`; uses ≤4-line `TASK APPROACH`, `FILE OPERATIONS`, and `CONSTRAINTS` sections; replaces the verbose `SYSTEM INFORMATION` block with a single-line `## SYSTEM` line; and omits `AGENTS.md` from the prompt by default. Brings the system prompt from ~500–700 tokens (`minimal`) down to ~150–250 tokens. Includes a new "Nano (low-end hardware)" preset and an **Include AGENTS.md** toggle.

- Added reasoning trace support. Reasoning content from models (Codex GPT-5, DeepSeek-R1-style, Anthropic extended thinking, etc.) now streams in real time, renders as a collapsible `Thought` block above the response, persists across history, and is included in logs. Toggle expansion with `Ctrl+R`, configure default expansion via the new **Display Settings** panel, and pin per-session via the tune `expandedReasoning` option. `<think>` tags are now stripped on the native tool-calling path so reasoning never leaks into rendered output. Thanks to @Daniel5055. Closes #457.

- Added refined **non-interactive mode**. A new `--plain` flag streams output suitable for CI pipelines, scripts, and pipes — no Ink rendering, no interactive prompts, deterministic exit codes, and proper handling of stdin/stdout. Includes a dedicated `non-interactive-shell` component and full test coverage for the plain transport.

- Reworked **VS Code extension** integration. Removed the "Ask Nanocoder" command in favour of a more natural flow: highlighted text and the currently focused file are automatically pulled into Nanocoder as context. Backed by a rewritten extension protocol, a simplified extension entrypoint, a new `useVSCodeServer` hook, and tighter UI hooks for the development mode indicator and chat input.

- Added `/rename` command for renaming the current chat session. Accessible from the chat input and reflected in the development mode indicator. Thanks to @lordoski.

- Added `defaultMode` config option for interactive sessions. Set a starting mode (`normal`, `auto-accept`, `yolo`, `plan`) in `agents.config.json` instead of always launching in normal mode. Thanks to @lordoski.

- Added **custom system prompt** support via `agents.config.json`. Define a project-level system prompt that replaces or augments the built-in prompt sections, with full validation and prompt-builder integration. Closes #487.

- Added per-provider and per-model **context window overrides** in `agents.config.json` via `contextWindow` and `contextWindows[model]`. New resolution order: session override (`/context-max`, `--context-max`) → provider model override → provider default → `NANOCODER_CONTEXT_LIMIT` → models.dev / Ollama fallback. `/usage`, status bar, auto-compact, and context reporting all use the active provider config consistently. Closes #455.

- Added subagent context window overrides so delegated agents can run with a different context limit than the main session. Thanks to @zerone0x.

- Added `disabledTools` config option in `agents.config.json` to disable specific built-in tools project-wide. Honoured by both the main agent and subagents.

- Added `--trust-directory` CLI flag to bypass the first-run directory trust prompt for automation. Yolo mode now also skips file path validators in line with its "auto-accept everything" semantics.

- Added JSON tool fallback mode for non-tool-calling open-weights models (Qwen, Kimi, GLM). The tune menu now cycles through Native ON / OFF (XML) / OFF (JSON), with `formatToolsForJSONPrompt()` embedding literal JSON Schema and a JSON branch in the tool-call parser. Native path also gains JSON/XML hallucination recovery: `parseToolCalls()` is run against text content when the SDK reports no `tool_calls`, and `stripEmbeddedToolCallText()` removes echoed tool-call text so Ghost Echo no longer leaks into the UI or history. Reference #500.

- Added `<function=...>` format to the tool-call parser for models that emit OpenAI-style function tags.

- Added **Display Settings** panel under `/settings` ("Tool Results and Thinking") with two new toggles: **Show Thinking by default** (Ctrl+R) and **Expand Tool Results by default** (Ctrl+O), persisted to `nanocoder-preferences.json`. Thanks to @cleyesode. Closes #499.

- Added 12+ new themes to the bundled theme set.

- Removed the in-repo release content generator workflow. Release content is now generated from another repo via ContentForest.

- Bumped CI and devcontainer toolchain to **Node.js 22** + **pnpm 11** across `pr-checks.yml`, `release.yml`, `update-badges.yml`, and `.devcontainer/Dockerfile`. `engines.node` raised to `>=22`, with a `packageManager` field (`pnpm@11.x.x`) added to `package.json` so Corepack pins the pnpm version automatically for both contributors and CI — no more drift, no per-workflow `version:` lines. `CONTRIBUTING.md` / `docs/getting-started/installation.md` / `.devcontainer/README.md` updated to match. Fixes the `node:sqlite` `ERR_UNKNOWN_BUILTIN_MODULE` crash hit by pnpm 11 on Node 20 runners.

- Migrated pnpm config from `package.json` to `pnpm-workspace.yaml` for pnpm 11 compatibility: `overrides`, `patchedDependencies`, and the new `allowBuilds` block now live in the workspace file. While migrating, audited and removed all 16 existing version overrides — every one was redundant under current dependency resolution (each transitive resolved to a version already exceeding the override's floor), and removing them left `pnpm audit` output unchanged.

- Major spring-clean refactor across the codebase. Extracted shared `oauth-login` command from the duplicated `codex-login` and `copilot-login` flows; introduced shared `item-selector` component used by `model-selector` and `provider-selector`; centralised `tool-needs-approval` logic; moved AI SDK error-handling specs into a dedicated subdirectory; tightened logging method factory; and trimmed redundant code paths in `conversation-loop`, `subagent-executor`, and the plain shell.

- Refactored `App.tsx` and added missing test coverage for the app container and chat input components.

- Refactored settings theme selector UX. Replaced the scrollable `SelectInput` with arrow-key navigation, real-time theme preview, and a "Theme Name [n/N]" position indicator. Preferences are only persisted on Enter.

- Updated the system prompt to encourage subagent use more proactively for complex multi-step tasks.

- Strip leading and trailing whitespace from assistant messages so blank lines and stray newlines from the model no longer push content around in the UI.

- Fix: Empty model responses now trigger a capped auto-continue instead of crashing or burning tokens forever. Empty-response retry notices are coalesced into a single live counter so the chat history stays readable.

- Fix: Surface context-size failures explicitly instead of silently retrying empty responses. Thanks to @zerone0x. Closes #501.

- Fix: Persist compressed messages across recursive conversation turns. Auto-compact now also resets the streaming token count after compression, with regression coverage to keep it stable. Thanks to @lordoski. Closes #480.

- Fix: Throw stream errors immediately during streaming instead of swallowing them and ending the response cleanly. Thanks to @alexbrjo.

- Fix: Cap malformed-XML retries to prevent OOM when a model gets stuck emitting broken tool-call XML in a tight loop. Reference #500.

- Fix: Stale `lastProvider` after running the config wizard mid-session — the next `/provider` invocation picked up the old value. Includes regression coverage. Thanks to @electricwolfemarshmallowhypertext. Closes #477.

- Fix: Inaccurate tok/s reporting in the streaming status line.

- Fix: File search, content search, and `@mention` autocomplete now work cross-platform. Replaced Unix-only `find`/`grep`/`which` shell-outs with pure Node.js implementations honouring `.gitignore` and `DEFAULT_IGNORE_DIRS`, restored the 30s search timeout via `AbortSignal`, and added Windows path normalisation. Thanks for the cross-platform report (#469).

- Fix: Read file tool description corrected.

- Fix: Type `MCPTool.inputSchema` as `JSONSchema7` instead of `any`, with `isPlainObject` guard at the MCP protocol boundary so malformed server schemas resolve to `undefined` rather than flowing through the system as a trusted type. Thanks to @ragini-pandey. Closes #467.

- Fix: Apply `caCertPath` TLS configuration to Anthropic and Google providers (previously only OpenAI-compatible providers honoured it), with cert path validation. Companion fix for custom CA bundle support across all providers. Thanks to @zerone0x. Closes #491 (#380).

- Fix: Reject ambiguous provider names with case-insensitive duplicates (e.g. both `Ollama` and `ollama` defined). Provider names are now resolved case-insensitively throughout. Thanks to @zerone0x. Closes #488.

- Fix: Quoted custom command arguments (double, single, and backtick) are now parsed as a single parameter so multi-word values survive tokenisation. Closes #478.

- Fix: Missing margin on the live sub-agent progress component.

- Fix: `git_pr` tool still required approval in yolo mode.

- Fix: `bash` mode no longer passes the currently selected file when not relevant.

- Fix: Incorrect passing of system prompt in some chat-handler paths.

- Fix: Default missing `subagent_type` and `description` parameters on the `agent` tool to safe values to prevent a UI crash when the model omits them.

- Fix: Model context limits failed to resolve for `gemma4`.

- Fix: Scheduler — clear the perf buffer between jobs to avoid an undici fetch leak that accumulated across long-lived scheduler sessions. Refresh the base system prompt for each scheduler execution so dynamic system info (current date, etc.) stays fresh.

- Fix: Reasoning trace follow-ups — restore post-loop `flushBuffer` safety net, persist reasoning on `assistantMsg` so it survives in history, default Codex `reasoningSummary=auto` and `reasoningEffort=medium` so GPT-5 reasoning actually renders, and resolve a system-prompt cache race where "No subagents available." was cached before the subagent loader finished.

- Fix: Various test/CI breakages from merges and refactors.

- Fix: Nix packaging — removed the unmaintained `snowfall-lib` dependency and improved overall packaging. Thanks to @PlasmaPower. Closes #459.

- Fix: Homebrew formula — switched the `node` dependency from `node@20` to `node@22` to prevent the `webidl.util.markAsUncloneable is not a function` startup crash. Thanks to @matthiasbolten. Closes #468.

- Fix: Repaired broken documentation references. Thanks to @breca.

- Security: Address Semgrep findings flagged across the codebase.

- Dependency updates: `ai` 6.0.116 → 6.0.174, `@ai-sdk/openai` 3.0.41 → 3.0.53, `@ai-sdk/google` 3.0.53 → 3.0.64, `@ai-sdk/openai-compatible` 2.0.35 → 2.0.41, `undici` 8.0.2 → 8.2.0, `react` 19.2.4 → 19.2.6, `yaml` 2.8.3 → 2.8.4, `dotenv` 17.3.1 → 17.4.2, `@nanocollective/get-md` 1.3.0 → 1.3.1, plus dev-dependency bumps for `@biomejs/biome`, `knip`, `tsc-alias`, `@ava/typescript`, `@vscode/vsce`, `@types/vscode`, `eslint`, and `strip-ansi`.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder.

# 1.25.2

- Fixed Nix package: copy `themes.json` and prompt section files into the Nix store so `nix run` no longer crashes at startup
- Fixed Nix package: corrected wrapper script heredoc indentation that broke the shebang line

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder.

# 1.25.1

- Removed rogue document from `docs/`

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder.

# 1.25.0

- Added **yolo mode** — a new development mode that auto-accepts every tool without exception, including bash commands and destructive git operations (hard reset, force delete, stash drop/clear). Cycles between normal → auto-accept → yolo → plan via Shift+Tab. The status bar turns red when yolo mode is active.

- Added subagents — isolated child conversations that the LLM can delegate work to. Ships with two built-in agents: **Explore** (read-only codebase investigation) and **Reviewer** (code review with actionable feedback). Subagents are defined as markdown files with YAML frontmatter specifying name, description, model, and allowed tools. User-defined subagents can be placed in `.nanocoder/agents/`. Managed via the `/agents` command (`show`, `create`). Thanks to @brijeshkr for the initial subagent implementation. Closes #414.

- Added concurrent subagent execution. The LLM can launch multiple subagents in parallel, each with independent tool sets and live in-place progress rendering via the `AgentProgress` component.

- Added subagent tool approval matching main agent behaviour. Subagent write tools prompt for approval and bash always prompts unless in `alwaysAllow`. The `agent` tool itself no longer requires approval since internal tools have their own gates.

- Redesigned the system prompt into a modular, composable architecture. The monolithic `main-prompt.md` has been replaced with individual section files under `source/app/prompts/sections/` (identity, core principles, coding practices, file editing, tool rules, diagnostics, task management, etc.). The new `prompt-builder` assembles the prompt dynamically based on the current mode — normal, auto-accept, plan, and scheduler each get a tailored prompt with only the sections and tools relevant to that mode. Includes a `generate-system-prompts` script for offline token counting and prompt inspection.

- Made plan mode useful. Plan mode now enforces read-only tools at the policy level — all mutation tools (write, bash, git commit/push, task management) are blocked, leaving only exploration tools (read, search, find, list, git log/diff/status). The dedicated plan mode system prompt instructs the LLM to investigate thoroughly and produce a structured plan with summary, files to modify, step-by-step approach, dependencies/risks, and open questions — instead of trying to execute changes.

- Added `/tune` command for per-session prompt and tool customization. Includes a tune selector UI (`Ctrl+T`) with tool profiles (full, minimal), a `disableNativeTools` toggle for forcing XML fallback, and aggressive compact mode. Tune state persists for the session and is reflected in the mode indicator.

- Centralized tool policy into `ToolManager` so prompt-time tool filtering and runtime approval use the same source of truth. Extracted `tool-registry.ts` for cleaner separation of tool definitions from policy logic.

- Added ChatGPT Codex as a provider with OAuth device flow authentication (`/codex-login`), streaming response support via a dedicated `StreamingMessage` component, and Codex-specific credential management. Includes provider template and setup wizard integration.

- Migrated `web_search` tool from Brave Search scraping to the official Brave Search API. Now requires a `webSearch.apiKey` in `agents.config.json` under `nanocoderTools`. Removes the `cheerio` scraping dependency.

- Added `/setup-config` command that lists all config files (project and global `agents.config.json`, `.mcp.json`, `nanocoder-preferences.json`) with their paths and opens the selected one in your editor.

- Added configurable paste threshold for single-line paste handling, with tests for the configurable placeholder threshold. The threshold is a user preference in `nanocoder-preferences.json`. Changed the default config file for paste settings from `agents.config.json` to `nanocoder-preferences.json`. Thanks to @grenkoca.

- Added live in-place task list display. Task progress now updates in place instead of appending repeated static lists to the conversation.

- Improved tool output truncation across all tools. Every tool formatter now respects terminal width for cleaner output, including `execute_bash`, file ops, git tools, `search_file_contents`, and `web_search`.

- Redesigned the provider setup wizard with a unified model fetcher that auto-detects API compatibility (OpenAI-compatible, Ollama, Anthropic, Google) and fetches available models from the provider's endpoint. Simplified the provider step UI and added MiniMax and Kimi provider templates.

- Fix: `alwaysAllow` config not being respected for `execute_bash`. Three interconnected bugs prevented it from working: top-level `alwaysAllow` was never loaded from `agents.config.json`, `isNanocoderToolAlwaysAllowed` only checked `nanocoderTools.alwaysAllow` not the top-level list, and `nonInteractiveAlwaysAllow` set `needsApproval` on AI SDK tools but the conversation loop evaluated it from the original registry entries. Closes #431.

- Fix: `dimColor` making text inaccessible to reading on some screens. Closes #440.

- Fix: Tasks now clear when running `/clear` command.

- Fix: Prevent edit flow from resolving MiniMax/Kimi to Anthropic template.

- Fix: Set correct default model for MiniMax provider.

- Fix: `/usage` and context percentage showing stale system prompt length. Added `setLastBuiltPrompt` and fixed `useContextPercentage` overwriting cache.

- Added debug logging to 15 silent catch blocks in git utilities that were swallowing errors invisibly. Operational catches now log at debug level for easier diagnosis while boolean probes (e.g. `isGitAvailable`, `branchExists`) remain intentionally silent. Thanks to @ragini-pandey. Closes #452.

- Security: Address semgrep security finding in console.error. Thanks to @brijeshkr.

- Security: Fixed vulnerable packages. Thanks to @brijeshkr.

- Security: Replaced `exec()` with `execFile()` in VS Code extension installer to prevent command injection. Removes shell interpretation from CLI discovery and extension status checks. Thanks to @ragini-pandey.

- Added `/credits` command showing project contributors (auto-generated from git history via `pnpm run build:credits`) and dependency versions.

- Added desktop notifications for tool confirmations, question prompts, and generation completions. Supports macOS (`terminal-notifier` with osascript fallback), Linux (`notify-send`), and Windows (PowerShell). Configurable per-event in `nanocoder-preferences.json` and in `/settings` with custom messages and optional sound. Includes a "Notifications" settings menu for preference management.

- Added CLI quality metrics framework (`benchmarks/measure.ts`, `benchmarks/report.ts`) tracking correctness, performance (module count, boot time, bundle size), stability (tool/command counts, help text hash), and health (test counts, vulnerabilities).

- Reduced startup time by parallelizing and deferring non-critical initialization. LLM client and subagent init run in parallel on the critical path; update checks, MCP servers, and LSP servers now initialize in the background without blocking chat. Replaced the full Status box with a lightweight one-line `BootSummary` component.

- Fix: Scheduler mode memory leak — chat messages and components now clear before each scheduled job execution, preventing memory accumulation across repeated runs.

- Fix: Updated agent documentation (`AGENTS.md`, `CLAUDE.md`) with current project structure (766 files across 97 directories), added missing directory mappings, removed deprecated references, and documented the lazy-loading command system.

- Fix: Improved Ollama timeout handling for slow local models. Timeout errors are now detected case-insensitively, and IPv6 loopback addresses are correctly resolved. Thanks to @ragini-pandey.

- Dependency updates

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder.

# 1.24.1

- Added `--context-max` CLI flag for setting the context limit from the command line, complementing the existing `/context-max` command and `NANOCODER_CONTEXT_LIMIT` env variable.

- Removed time from the system prompt to keep the KV cache more stable across requests. Thanks to @initialxy. Closes #415.

- Task tool results are no longer displayed as compacted results during ensuring task progress remains visible in the conversation.

- User input now uses the same text wrapping as assistant messages for a more consistent chat appearance.

- Improved `search_file_contents` tool robustness.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder.

# 1.24.0

- **BREAKING**: Removed legacy `~/.agents.config.json` config file support. Nanocoder no longer checks the home directory for a dot-prefixed config file. If you are still using this path, move your config to the platform-specific directory: `~/Library/Preferences/nanocoder/agents.config.json` (macOS), `~/.config/nanocoder/agents.config.json` (Linux), or `%APPDATA%\nanocoder\agents.config.json` (Windows).

- **BREAKING**: Removed legacy `~/.nanocoder-preferences.json` preferences file support. Preferences are now only loaded from the platform-specific directory (e.g. `~/Library/Preferences/nanocoder/nanocoder-preferences.json` on macOS) or a project-level `nanocoder-preferences.json` in your working directory. To migrate, move your existing file: `mv ~/.nanocoder-preferences.json ~/Library/Preferences/nanocoder/nanocoder-preferences.json`

- **BREAKING**: Removed deprecated array format for MCP server configuration. Only the object format is now supported: `{ "mcpServers": { "serverName": { ... } } }`. If you are using the array format in `.mcp.json`, convert each array entry to an object key using the server name.

- **BREAKING**: Removed `agents.config.json` fallback for MCP server loading. Global MCP servers must now be configured in `~/.config/nanocoder/.mcp.json` (Linux), `~/Library/Preferences/nanocoder/.mcp.json` (macOS), or `%APPDATA%\nanocoder\.mcp.json` (Windows). Provider configuration still uses `agents.config.json`.

- **BREAKING**: Removed `auth` and `reconnect` fields from MCP server configuration. The `auth` field was never functional (both HTTP and WebSocket transports logged warnings that it was unsupported). The `reconnect` field was never implemented. Use `headers` for HTTP authentication instead (e.g. `"headers": { "Authorization": "Bearer $TOKEN" }`).

- Added `/resume` command for restoring previous chat sessions. Sessions are automatically saved and can be resumed from an interactive selector. Sessions are filtered by the current project directory by default, with an `--all` flag to show all sessions. Thanks to @yashksaini-coder.

- Added `--provider` and `--model` CLI flags for non-interactive provider and model specification, allowing CI/CD scripts and automation to skip the setup wizard. Closes #394. Thanks to @james2doyle.

- Added `NANOCODER_PROVIDERS` environment variable support for configuring providers without config files, useful for Docker containers and CI environments. Closes #307. Thanks to @kaustubha07.

- Added GitHub Copilot as a provider template with OAuth device flow authentication and `/copilot-login` command. Thanks to @yashksaini-coder.

- Added MLX Server provider template for local Apple Silicon inference. Closes #318.

- Added parallel tool execution allowing the model to run multiple independent tool calls concurrently for faster task completion.

- Added compact mode toggle via `Ctrl+L` in chat input to collapse the conversation view.

- Added VS Code fork support for IDE integration (Cursor, Windsurf, VSCodium, etc.). Thanks to @kapsner.

- Added Aurora Borealis theme.

- Added notice when the model falls back to XML tool calls, informing users they can switch to a model with native tool calling support.

- Adopted AI SDK human-in-the-loop pattern for tool approval. Tool confirmation now uses the SDK's built-in `tool-approval-request`/`tool-approval-response` flow instead of manual tool-call splitting, improving reliability and reducing code complexity.

- Simplified tool processing by removing double XML parsing and the JSON tool call parser. Tool call parsing now happens in a single place and only on the XML fallback path for non-tool-calling models.

- Restructured documentation into a Nextra-compatible `docs/` folder structure with nested sections for getting-started, configuration, and features. The README is now a concise landing page linking to the full docs.

- Refactored app-utils into focused handler files, extracted shared utilities, unified mode state, and stubbed commands for cleaner architecture.

- Fix: `alwaysAllow` field in MCP server configuration was silently dropped during config loading due to a missing field mapping. MCP tools configured with `alwaysAllow` now correctly skip confirmation prompts as documented.

- Fix: Provider timeouts are now respected in non-interactive mode. Thanks to @kaustubha07. Closes #402.

- Fix: Non-interactive mode no longer exits prematurely when the prompt or response contains the word "error".

- Fix: Invalid CLI arguments no longer trigger the setup wizard. Thanks to @james2doyle.

- Fix: Installation detector no longer falsely reports Homebrew on macOS when `HOMEBREW_PREFIX` is set but Nanocoder was installed via npm. Closes #392.

- Fix: Preserve draft message when navigating through history with arrow keys.

- Fix: `fetch_url` display now truncates to fit terminal width.

- Fix: Validation failures no longer incorrectly prompt for tool confirmation.

- Fix: Various error message and `execute_bash` formatter improvements.

- Fix: Safe process metrics refactored into shared module to prevent duplicate declarations. Thanks to @cleyesode.

- Security: Package audit failures resolved.

- Dependency updates: `ai` 6.0.116, `@ai-sdk/anthropic` 3.0.58, `@ai-sdk/google` 3.0.33, `@ai-sdk/openai-compatible` 2.0.30, `@modelcontextprotocol/sdk` 1.27.1, `undici` 7.24.0, `cheerio` 1.2.0, `dotenv` 17.3.1, `wrap-ansi` 10.0.0.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder.

# 1.23.0

- Added `ask_user` tool for interactive question prompts. The LLM can now present the user with a question and selectable options during a conversation, returning their answer to guide the next step. Uses a global question-queue to bridge the tool's suspended Promise with the Ink UI component.

- Added per-project cron scheduler for running AI tasks on a schedule. Schedule files live in `.nanocoder/schedules/` as markdown prompts with YAML frontmatter, managed via the `/schedule` command (`create`, `add`, `remove`, `list`, `logs`, `start`). Includes cron expression parsing, sequential job queue with deduplication, dedicated scheduler mode with auto-accept, and run history logging.

- Added centralized graceful shutdown system. A `ShutdownManager` now coordinates cleanup of all services (VS Code server, MCP client, LSP manager, health monitor, logger) on exit, preventing orphaned child processes and dangling connections. Configurable via `NANOCODER_DEFAULT_SHUTDOWN_TIMEOUT` env variable. Closes #239.

- Added file operation tools: `delete_file`, `move_file`, `create_directory`, and `copy_file`. Reorganized existing file tools into a `file-ops/` directory group.

- Added readline keybind support to text input. Replaces `ink-text-input` with a custom `TextInput` component supporting Ctrl+W (delete word), Ctrl+U (kill to start), Ctrl+K (kill to end), Ctrl+A/E (jump to start/end), and Ctrl+B/F (move char). Closes #354.

- Added `/context-max` command and `NANOCODER_CONTEXT_LIMIT` env variable for manual context length override on models not listed on models.dev. Resolution order: session override > env variable > models.dev > null. Closes #379.

- Added `/ide` command matching the `--vscode` flag for toggling VS Code integration from within a session.

- Added persistent context percentage display in the mode indicator, replacing the previous context checker component.

- Added `include` and `path` parameters to `search_file_contents` tool for scoping searches to specific file patterns and directories.

- Added Kanagawa theme.

- Refactored the skills system into custom commands, eliminating redundant parsers, loaders, and test suites. Commands gain optional skill-like fields (`tags`, `triggers`, `estimated-tokens`, `resources`) for auto-injection and relevance scoring. The `/skills` command is removed and its functionality absorbed into `/commands` with new subcommands (`show`, `refresh`). Thanks to @yashksaini-coder for the initial skills implementation in PR #370.

- V2 type-safe tool system overhaul with defensive parsing. Implements a three-tiered defense system for handling chaotic LLM outputs, preventing crashes from non-string responses and enabling robust self-correction. Includes universal type safety with `ensureString()`, response normalization, confidence system inversion, ghost echo deduplication, and AI SDK contract fixes. Local LLM experience is now significantly more stable. Thanks to @cleyesode. Closes #362.

- Fix: XML parser now uses optimistic matching for consistency with the JSON parser. Thanks to @cleyesode.

- Fix: Bash tool now emits progress immediately on stdout/stderr data instead of waiting for the 500ms timer, so fast-completing commands show streaming output.

- Fix: Recognize `127.0.0.1` as a local server URL and tighten error classification. Ollama users configuring `127.0.0.1` instead of `localhost` no longer experience misleading connection errors. Replaced broad `connect` substring match with specific error codes to prevent misclassifying "disconnect"/"reconnect". Closes #366.

- Fix: Skip loading git tools when not inside a git repository.

- Fix: Strip ANSI escape codes before running regex matching in tool formatters.

- Fix: Gap in layout during auto-compact.

- Fix: Hardened `write_file` validation and MCP client type safety.

- Fix: Use local `TextInput` component instead of the missing `ink-text-input` package.

- Fix(mcp): Use Python-based `mcp-server-fetch` instead of non-existent npm package.

- Security: Semgrep and audit fixes.

- Dependency updates: `ai` 6.0.95, `@ai-sdk/anthropic` 3.0.46, `@ai-sdk/google` 3.0.30, `undici` 7.22.0, `sonic-boom` 4.2.1.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.22.5

- Added MiniMax Coding Plan and GLM-5 to provider templates in the configuration wizard.

- Fix: Model context limit lookups now use models.dev as the primary source instead of the hardcoded fallback table. This prevents stale hardcoded values from overriding accurate upstream data. The hardcoded table remains as an offline-only fallback. Also fixes greedy key matching where shorter keys like `mixtral` would match before `mixtral:8x22b`, and replaces first-match name lookups with scored matching for more accurate results.

- Fix: Binary and excessively large files tagged with `@` no longer pollute the LLM context window with unreadable content.

- Fix: Diff preview panel no longer steals terminal focus from the active input.

- Fix: Reduced verbosity of the `string_replace` error formatter output.

- Fix: Reject null and non-object arguments in JSON tool calls, preventing formatter crashes from malformed tool call arguments. Thanks to @cleyesode.

- Fix: Restored `formatError` usage for validation and execution errors.

- Dependency updates: `ink-gradient` 4.0.0, `react` 19.2.4, `@nanocollective/get-md` 1.1.1, `@ai-sdk/anthropic` 3.0.43, `pino` 10.3.1, `@types/react` 19.2.14.

# 1.22.4

- Security: Tool validators now run inside the AI SDK's auto-execution loop. Previously, tools with `needsApproval: false` (like `read_file`) were auto-executed by the AI SDK's `generateText` without any path validation, allowing the model to read or write files outside the project directory using absolute or `~` paths. Validators are now wrapped into each tool's `execute` function at registration time, ensuring validation runs in all code paths.

- Security: Reject home directory shorthand (`~`) in file path validation. Paths starting with `~` are not expanded by Node.js and could bypass project boundary checks.

- Fix: Tab characters in code blocks within assistant messages now render at 2-space width instead of the terminal default of 8 spaces. This prevents long lines from wrapping prematurely and eliminates the blocky visual effect on messages containing indented code.

- Fix: `normalizeIndentation` no longer short-circuits when the minimum indent is 0. Previously, if any line in the context window had zero indentation, raw tab characters passed through to the terminal unchanged, rendering at 8-space width in `string_replace` diff previews.

# 1.22.3

- Fix: Removed tool call deduplication from JSON parser that silently dropped duplicate tool calls, breaking the 1:1 pairing between tool calls and results expected by AI SDK. This caused "Tool result is missing for tool call" errors that would end the agent's turn prematurely. Consolidated three overlapping regex patterns into a single comprehensive pattern to prevent duplicate matches. Thanks to @cleyesode.

- Fix: Added missing capture group for arguments in the consolidated JSON tool call regex pattern, which caused inline tool calls to have empty arguments instead of actual parsed values.

- Fix: When the model batched read-only and write tools in a single response (e.g. `read_file` + `string_replace`), the auto-executed read tools would recurse into the next conversation turn, abandoning the confirmation-needed write tools. This left orphaned `tool_use` blocks without matching `tool_result` entries, triggering intermittent "Tool result is missing for tool call" errors with the Anthropic provider.

- Dependency updates: `@ai-sdk/openai-compatible` 2.0.27, `undici` 7.21.0, `@biomejs/biome` 2.3.14, `@types/vscode` 1.109.0, `@types/node` 25.2.1.

# 1.22.2

- Fix: Markdown tables in assistant messages were rendered at full terminal width instead of accounting for the message box border and padding, causing broken box-drawing characters when lines wrapped.

# 1.22.1

- Added native Anthropic SDK support via `@ai-sdk/anthropic` package. The Anthropic Claude provider template now uses `sdkProvider: 'anthropic'` for direct API integration instead of the OpenAI-compatible wrapper.

- Fixed Kimi Code provider template to use the native `@ai-sdk/anthropic` SDK with correct base URL and configuration passthrough.

- Fix: User message token count now reflects the full assembled content including pasted content and tagged file contents, instead of only counting the placeholder text.

- Fix: Removed aggressive tool call deduplication that silently dropped duplicate tool call IDs and identical function signatures. This could cause "Tool result is missing for tool call" errors with providers like Anthropic that strictly validate tool call/result pairing.

# 1.22.0

- Added `/explorer` command for interactive file browsing with tree view navigation, file preview with syntax highlighting, multi-file selection, search mode, and VS Code integration. Closes #298.

- Added task management tools (`create_task`, `list_tasks`, `update_task`, `delete_task`) with `/tasks` slash command for models to track and manage progress on complex work. Tasks persist in `.nanocoder/tasks.json` and are automatically cleared on CLI boot and `/clear` command.

- Added `/settings` command for interactive command menu to configure UI theme and shapes without editing config files directly.

- Added `sdkProvider` configuration option for native Google Gemini support. This fixes the "missing thought_signature" error with Gemini 3 models by using the `@ai-sdk/google` package. Closes #302.

- Added custom headers support in provider configuration. This enables authentication through tunnels like Cloudflare. Thanks to @nicolalamacchia.

- Added Kimi Code provider template in configuration wizard.

- Added new themes with updated user input and user message styling for better visual clarity and consistency.

- Added token count display after messages and completion message to provide visibility into context usage throughout conversations.

- Refactored git tools for better consistency, improved error handling, standardized parameter handling across all git operations, and enhanced user feedback messages.

- Added line truncation in `write_file` and `string_replace` formatters to prevent excessive output from files with very long lines and neaten user experience on narrow terminals.

- Fix: `/usage` command crash when context data is unavailable.

- Fix: String replace error handling for edge cases.

- Fix: Multiple security audit issues resolved.

- Fix: Various styling improvements across components.

- Fix: Dependency lockfile issues resolved.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.21.0

- Added `/compact` command for context compression with `--restore` flag support to restore messages from backup. The command now includes auto-compact functionality, consistent token counting, and improved compression for very long messages. Thanks to @Pahari47.

- Added hierarchical configuration loading for both provider configs and MCP servers. Local project configurations now properly override global settings, and Claude Code's object-style MCP configuration format is now supported. Thanks to @Avtrkrb.

- Added `alwaysAllow` configuration option for MCP servers to auto-approve trusted tools without confirmation prompts. Thanks to @namar0x0309.

- Added automatic tool support error detection and retry mechanism. Models that don't support function calling are now detected and requests automatically retry without tools. Thanks to @ThomasBrugman.

- Added `--version` and `--help` CLI command options for quick reference. Thanks to @Avtrkrb.

- Added `/quit` command as an alternative way to exit Nanocoder. Thanks to @Avtrkrb.

- Added `/nanocoder-shape` command for selecting branding font styles.

- Added keyboard shortcuts documentation to README.

- Renamed `/setup-config` to `/setup-providers` for clearer naming.

- Improved `/mcp` command modal with better colors and title formatting. Thanks to @Avtrkrb.

- Improved `/help` command title heading styling. Thanks to @Avtrkrb.

- Added CLI test harness for non-interactive mode testing. Thanks to @akramcodez.

- Added comprehensive test suite for tool error detection. Thanks to @ThomasBrugman.

- Added `DisableToolModels` documentation to README. Thanks to @ThomasBrugman.

- Fix: Resolved bash tool keeping processes alive after command completion.

- Fix: Corrected log directory paths and enabled file logging in production.

- Fix: Improved deprecation message for MCP config to display correct config directory instead of hardcoded Linux path. Thanks to @Avtrkrb.

- Fix: Resolved shell command security scanning alerts built from environment values. Thanks to @Avtrkrb.

- Fix: Security audit dependencies updated.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.20.4

- Fixed configuration wizard blocking users from entering HTTP URLs for remote Ollama servers. The wizard now allows any valid HTTP/HTTPS URL without requiring local network addresses.

- Fixed `@modelcontextprotocol/sdk` dependency version to resolve npm audit security issue.

- Fixed TLS certificate errors when using `uvx` MCP servers behind corporate proxies. Nanocoder now automatically adds `--native-tls` to uvx commands to use system certificates instead of rustls.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.20.3

- Fixed `search_file_contents` returning excessive tokens by truncating long matching lines to 300 characters. Previously, searching in files with long lines (minified JS, base64 data, etc.) could return ~100k tokens for just 30 matches.

- Added validation to `read_file` to reject minified/binary files (lines >10,000 characters). These files consume excessive tokens without providing useful information to the model. Use `metadata_only=true` to still check file properties.

- Fixed `web_search` result count display showing mismatched values (e.g., "10 / 5 results"). The formatter now correctly uses the same default as the search execution.

- Improved `web_search` and `fetch_url` formatter layouts to match `execute_bash` style with consistent column alignment and spacing.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.20.2

- Added preview generation to git workflow tools (`git-status-enhanced`, `git-smart-commit`, `git-create-pr`) showing results before execution.

- Fixed `string-replace` line number display in result mode - now correctly shows line numbers of new content after replacement.

- Added hammer icon (⚒) to git tool formatters for visual consistency.

- Improved formatting in `bash-progress`, `execute-bash`, and `read-file` tools with better spacing and layout.

- Simplified `string-replace` validation logic and removed redundant success messages.

- Fix: Running `/init --force` added duplication to `AGENTS.md`.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.20.1

Fix: React Context Error - useTitleShape must be used within a TitleShapeProvider

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.20.0

Happy New Year! We all hope you had a great holidays and are feeling refreshed ready for 2026 🌟

- Added Catpuccin themes (Latte, Frappe, Macchiato, Mocha) with gradient color support. Thanks to @Avtrkrb.

- Added VS Code context menu integration - you can now right-click selected code and ask Nanocoder about it directly.

- Added comprehensive testing achieving 90%+ code coverage across components, hooks, tools, and utilities. Tests now include unit and integration coverage for critical paths.

- Added automated PR checks workflow with format, type, lint, and test validation. Pull requests now get automatic quality checks. Thanks to @Avtrkrb.

- Added LSP support for Deno, GraphQL, Docker/Docker Compose, and Markdown language servers with automatic project detection. Thanks to @yashksaini-coder.

- Added auto-fetch models feature in setup wizard - providers can now automatically fetch available models during configuration. Thanks to @JimStenstrom.

- Added git workflow integration tools including smart commit message generation, PR template creation, branch naming suggestions, and enhanced status reporting. Thanks to @JimStenstrom.

- Added file content caching to reduce tool confirmation delays and improve performance. Thanks to @JimStenstrom.

- Added path boundary validation to file manipulation tools to prevent directory traversal attacks.

- Added granular debug logging with structured pino logger throughout catch blocks for better error tracking. Thanks to @JimStenstrom and @abhisek1221.

- Added devcontainer support for streamlined development environments. Thanks to @Avtrkrb.

- Added stylized title boxes with powerline-style shapes and real-time preview in custom commands. Thanks to @Avtrkrb.

- Added real-time bash output progress with live updates during command execution.

- Added inline word-level highlighting to string_replace diff display for clearer change visualization.

- Improved code exploration tools with better tool calling prompts and descriptions and new `list_directories` tool. Thanks to @DenizOkcu.

- Centralized token calculation in tools with consistent usage display in formatters. Thanks to @DenizOkcu.

- Added AI SDK error types for better tool call error handling. Thanks to @DenizOkcu.

- Centralized ignored file patterns usage throughout Nanocoder for consistency. Thanks to @DenizOkcu.

- Refactored App component into focused modules (useAppState, useAppInitialization, useChatHandler, useToolHandler, useModeHandlers) for better maintainability.

- Refactored message components to unify structure and fix memoization inconsistency. Thanks to @abhisek1221.

- Refactored handleMessageSubmission into focused handler functions for better code organization. Thanks to @JimStenstrom.

- Refactored health-monitor, log-query, and AISDKClient into smaller focused modules.

- Renamed multiple files to kebab-case for consistency (AISDKClient.ts → ai-sdk-client.ts, appUtils.ts → app-util.ts, conversationState.ts → conversation-state.ts). Thanks to @JimStenstrom.

- Replaced sync fs operations with async readFile for better performance. Thanks to @namar0x0309.

- Improved tool formatter indentation for better readability.

- Extracted magic numbers to named constants for better code clarity. Thanks to @JimStenstrom.

- Enhanced validateRestorePath to check directory writability. Thanks to @yashksaini-coder.

- Fix: Resolved "Interrupted by user" error appearing on empty model responses.

- Fix: Command completion now prioritizes prefix matches over suffix matches for more intuitive autocomplete.

- Fix: Resolved duplicate React keys issue by using useRef for component key counter. Thanks to @JimStenstrom.

- Fix: Development mode context synchronization prevents autoaccept race conditions. Thanks to @JimStenstrom.

- Fix: Bounded completedActions array to prevent memory growth during long sessions. Thanks to @JimStenstrom.

- Fix: User input cycling now works correctly.

- Fix: Slash + Tab now shows all available commands instead of subset.

- Fix: Command injection vulnerabilities in shell commands resolved.

- Fix: Large paste truncation in slow terminals resolved. Thanks to @Alvaro842DEV.

- Fix: find_files tool now correctly recognizes all pattern types.

- Fix: Tool over-fetching in find and search tools reduced for better performance. Thanks to @pulkitgarg04.

- Fix: Prompt history handling improved with better state management.

- Fix: Paragraphs now render correctly in user messages.

- Fix: Added helpful error messages for missing MCP server commands. Thanks to @JimStenstrom.

- Fix: Size limits added to unbounded caches to prevent memory issues.

- Fix: Resolved several security scanning alerts for string escaping and encoding. Thanks to @Avtrkrb.

- Fix: Switched to crypto.randomUUID and crypto.randomBytes for secure ID generation. Thanks to @JimStenstrom and @abhisek1221.

- Fix: Broken pino logging documentation link in README.

- Fix: Husky pre-commit hook configuration improved. Thanks to @Avtrkrb.

- Fix: Silent configuration issues resolved. Thanks to @sanjeev55999999.

- Fix: Added debug logging to empty catch blocks in LSP modules to improve error tracking and debugging. Thanks to @JimStenstrom.

- Fix: Prevented process hang when exiting security disclaimer for better user experience. Thanks to @JimStenstrom.

- Fix: Handled line wrap in read-file metadata test to ensure proper test reliability. Thanks to @JimStenstrom.

- Fix: Use cmd.exe on Windows for command spawning to resolve cross-platform shell issues.

- Fix: LSP diagnostics tool now properly handles non-existent files.

- Fix: /clear command UI display restored.

- Fix: Bun runtime detection added to LoggerProvider. Thanks to @JimStenstrom.

- Fix: Resolved race conditions in singleton patterns and improved VS Code integration.

- Fix: LoggerProvider async loading completion issues resolved.

- Fix: Cleanup timeout leak in LSP client.

- Fix: Duplicate SIGINT handler issues resolved.

- Fix: High severity qs vulnerability patched via pnpm override. Thanks to @Pahari47.

- Fix: Removed line numbers from tagging files and read_file tool as it confused models when pattern matching content changes.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.19.2

- Refactored file editing tools by replacing line-based tools with modern content-based editing for better reliability and context efficiency.

- Replaced `create_file` with `write_file` - a tool for whole-file rewrites, ideal for generated code, config files, complete file replacements and the creation of new files.

- Optimized system prompt to be more concise and reduce token usage.

- Fix: Tool call results were incorrectly being passed as user messages, causing hallucinations in model responses. This has caused great gains for models like GLM 4.6 which commonly struggles with context poisoning.

- Fix: `/usage` command now correctly displays context usage information.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.19.1

- Fix Nix releases.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.19.0

- Added non-interactive mode for running Nanocoder in CI/CD pipelines and scripts. Pass commands via CLI arguments and Nanocoder will execute and exit automatically. Thanks to @namar0x0309.

- Added conversation checkpointing system with interactive loading for saving and restoring conversation state across sessions. Thanks to @akramcodez.

- Added enterprise-grade Pino logging system with structured logging, request tracking, performance monitoring, and configurable log levels. Thanks to @Avtrkrb.

- Switched to Biome for formatting and linting, replacing Prettier and ESLint for faster, more consistent code quality tooling. Thanks to @akramcodez.

- Added Poe.com as a provider template in the configuration wizard. Closes issue #74.

- Added Mistral AI as a provider template in the configuration wizard.

- Updated Ollama model contexts.

- Added `--force` flag to `/init` command for regenerating AGENTS.md without prompting.

- Removed `ink-titled-box` dependency and replaced it with a custom implementation. Closes issue #136.

- Fixed security vulnerabilities by addressing pnpm audit reports. Thanks to @spinualexandru.

- Fixed README table of contents anchors for proper navigation on GitHub forks. Thanks to @Azd325.

- Refactored GitHub Actions workflows to reduce duplication and improve maintainability.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.18.0

- Upgraded to AI SDK v6 beta to improve model and tool calling performance and introduce multi-step tool calls support. Thanks to @DenizOkcu.

- Added `/debugging` command to toggle detailed tool call information for debugging purposes. Thanks to @DenizOkcu.

- Replaced `/recommendations` command with `/model-database` command that provides searchable model information from an up-to-date database, making model recommendations easier to maintain.

- Added GitHub issue templates for bug reports and feature requests to improve community contributions.

- LSP and MCP server connection status is now displayed in the Status component, providing cleaner visibility and removing verbose connection messages from the main UI. Thanks to @Avtrkrb.

- Various improvements to context management, error handling, and code refactoring for better maintainability.

- Fixed locale-related test failures by setting test environment to en-US.UTF-8. Thanks to @DenizOkcu.

- Removed streaming for now as it continued having issues with layouts, flickering and more, especially with the upgrade to AI SDK v6.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.17.3

- Added GitHub models as a provider addressing issue #67 with minimal code changes. Thanks to @JimStenstrom

- Added `/lsp` command to list connected LSP servers. Thanks to @anithanarayanswamy

- Fix: Improve error handling for Ollama JSON parsing. Addresses issue #87. Thanks to @JimStenstrom

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.17.2

- Fix: Remote GitHub MCP Connection Fails with 401 Unauthorized.
- Fix: LSP Server Discovery Fails for Servers Without --version Flag.
- Fix: Model Context Protocol (MCP) Configuration Wizard Fails for Servers with No Input Fields.

^ Thanks to @Avtrkrb for finding and handling these fixes.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.17.1

- Fix: Use virtual documents instead of temp files to prevent linters running on diff previews within the VS Code plugin.

- Fix: Restore terminal focus after showing diff in VS Code plugin.

- Fix Close diff preview when user presses escape to cancel a tool in VS Code plugin.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.17.0

- NEW VS Code extension - complete with live code diffs, diagnostics and more. This is version 1 of this with LSP support. There is a lot more room to expand and improve.

- Several big overhauls and fixes within MCPs - thanks to @Avtrkrb for handling the bulk of this.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.16.5

- `/init` no longer generates an `agents.config.json` file as per new configuration setup.

- Refactoring code to reduce duplication. Thanks to @JimStenstrom.

- Fix: Nix installation was broken. Fixed thanks to @Thomashighbaugh.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.16.4

- Decouple config vs data directories to introduce clear separation between configuration and application data directories. Thanks to @bowmanjd pushing this update.

- Update checker now attempts to detect how you installed Nanocoder and uses that to update with CLI with. It all also presents, update steps to the user correctly to do manually. Thanks to @fabriziosalmi for doing this.

- Added Dracula theme.

- Fix: Command auto-complete would only work if there was just one command left to auto-complete to. Now whatever the top suggestion is is the one it autocompletes to.

- Fix: Improved paste detection to create placeholders for any pasted content (removed 80-char minimum), fixed consecutive paste placeholder sizing, paste chunking for VSCode and other terminals.

- Fix: Creating new lines in VSCode Terminal was broken. This has now been fixed.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.16.3

- Fix: Update checker used old rendering method so it appeared broken and always checking for an update. This has now been resolved.

- Fix: Config files now correctly use `~/.config/nanocoder/` (or platform equivalents) instead of `~/.local/share/nanocoder/`, restoring proper XDG semantic separation between configuration and data. Thanks to @bowmanjd for patching this.

- Fix: Many edge-case fixes in the markdown parser for assistant messages. Outputs are far cleaner now.

- Removed message display limit, you can now see the entire session history. The message queue is very well optimised at this point so we can afford to.

- Removed `read_many_files` tool, it's rarely used by models over `read_file` and provides little benefit.

- Removed `search_files` tool as models often found it confusing for finding files and content.

_In replacement:_

- Added the `find_files` tool. The model provides a pattern and the tool returns matching files and directory paths.

- Added `search_file_contents` tool. The model provides a pattern and the tool returns matching content and metadata for further use.

- Revised `read_file` tool to reveal progressive information about a file. Called on its own, it'll return just file metadata, the model can also choose to pass line number ranges to get specific content.

- Update main prompt to reflect.

_^ All of the above is in effort to better manage context when it comes to models using tools. Some smaller models, like Qwen 3 Coder 30B struggle from intense context rot so these improvements are the first in a set that'll help small models make more accurate and purposeful tool calls._

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.16.2

- Fix: Models returning empty responses after tool execution now automatically reprompted.

- Fix: HTML tags in responses no longer trigger false tool call detection errors.

- `search_files` tool limited to 10 results (reduced from 50) to prevent large outputs
- `execute_bash` output truncated to 2,000 chars (reduced from 4,000) and returns plain string.

- Model context limit tests updated to match actual implementation

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.16.1

- Fix: Removed postinstall hook that caused installation failures due to missing scripts directory in published package. Models.dev data is now fetched on first use instead of during installation.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.16.0

- New `/usage` command! Visually see model context usage. Thanks to @spinualexandru for doing this. Closes issue #12. 🎉

- Added new models to the recommendations database.

- Fix: Model asked for permission to call tools that didn't exist. It now errors and loops back to the model to correct itself.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.15.1

- Fix: Sometimes Ollama returns tool calls without IDs, this caused empty responses occassionally. If no ID is detected, we now generate one.

- Fix: Homebrew installer was not working correctly.

- Fix: Node version requirement is now 20+.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.15.0

- Big: Switched backend architecture to use AI SDK over LangGraph. This is a better fit for Nanocoder for many reasons. Thanks to @DenizOkcu for doing this switch.

- Tag files and their contents into messages directly use the `@` symbol. Nanocoder will fuzzy search and allow to choose which files.

- New message streaming to see agent respond in realtime. Toggle stream mode on and off via the `/streaming` command.

- Added Homebrew installation option.

- Improved command auto-complete by adding fuzzy search.

- Improved table rendering in CLI by switching out the custom renderer for the more robust `cli-table3` library.

- Improved non-native tool call parsing by refining the XML/JSON parsing flow.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.14.3

- Added Nix package installation option. Thanks to @Lalit64 for closing issue #75.
- Chore: bumped `get-md` package version to the latest.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

## 1.14.2

- Fix: issue #71. Markdown tables and HTML entities are now rendering properly in model responses.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

## 1.14.1

- Switched out Jina.ai that fetched LLM optimised markdown from URLs to our own, on-device, private Nano Collective package: [get-md](https://github.com/Nano-Collective/get-md).
- `search_files` tool now ignores contents of `.gitignore` over just a pre-defined set of common ignores.
- If you use OpenRouter as a provider, it now logs "Nancoder" as the agent.
- Fix: Added `parallel_tool_calls` to be equal to `false` in the LangGraph client. This helps bring some stability and flow to models especially when editing files.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

## 1.14.0

- Added `/setup-config` command - an interactive wizard for configuring LLM providers and MCP servers with built-in templates for popular services. Includes real-time validation, manual editing support (Ctrl+E), and automatic configuration reload.
- Revamped testing setup to now:
  - Check formatting with Prettier
  - Check types with tsc
  - Check for linting errors with Eslint
  - Run AVA tests
  - Test for unnused code and dependencies with Knip
- The full test suite passes for version 1.14.0 with no errors or warnings. Nanocoder should feel and work more robustly than ever!

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

## 1.13.9

- Added Anthropic Claude Haiku 4.5 to model database.
- UI updates to welcome message, status and user input placeholder on narrow terminals.
- Updated `CONTRIBUTING.md` and `pull_request_template.md` to reflect new testing requirements.
- Fix: Declining a tool suggestion and then sending a follow up message caused an error.
- Fix: Removed duplicate `hooks` directories and consolidated into one.
- Fix: Removed unneccessary `ollama` package.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

## 1.13.8

- Fix: Issue #55
- Rolling out testing to the release pipeline

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

## 1.13.7

- Updated `LICENSE.md` to be `MIT License with Attribution`. This was done to keep the spirit of MIT but also ensure the technology built by contributors is properly credited.
- We added a new system prompt with better instructions, ordering, tool documentation and included system information.

  - Old system prompts are dated using the following format: `yyyy-mm-dd-main-prompt.md` where the date is when the prompt was retired.

- Fix: import aliases within the code now use `@/` syntax _without_ file extensions. This is an under-the-hood refactor to improve code readability and use more modern standards.
- Fix: All but the last message in the chat was made static through Ink. This still causes _some_ terminal flicker if the last message was a long one. All messages are immediately made static now to further improve performance.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

## 1.13.6

- Added `CHANGELOG.md` and rolled out changelogs to releases.
- Updated the `/clear` command output UI to read "Chat Cleared." over "✔️ Chat Cleared..."
- Refactored `langgraph-client.ts` to removed old methods that are no longer needed. Rolled out this change to `useChatHandler.tsx`. This results in smaller, more tidy files.
- Fix: LangGraph errors leaked through to UI display. This is now tidied to be from Nanocoder.
- Fix: Pressing Escape to cancel model responses was not instant and sometimes didn't work.
