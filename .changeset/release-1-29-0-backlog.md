---
"@nanocollective/nanocoder": minor
---

- Added **privacy-aware prompt scrubbing**. A new `PrivacyContext` scrubs sensitive content from prompts before they leave your machine, with tool-argument rehydration and privacy session support, a `/privacy` command to inspect what is being scrubbed, and automated scrubbing telemetry notifications. Thanks to @akramcodez.

- Added an **interactive questions system for plan mode**, so the agent can ask structured questions while planning instead of guessing. Thanks to @akramcodez. Closes #96.

- Added **mode-specific provider and model configuration**, so each development mode can use its own provider and model. Thanks to @akramcodez. Closes #277.

- Added **dual TUI screen modes**, with a more reliable `/clear` and graceful exit handling. Thanks to @llupRisinglll.

- Added **multiline cursor navigation and word-jump** in the input box. Thanks to @llupRisinglll.

- Added **PDF and DOCX support to `read_file`** via get-md, so those documents can be read directly. Thanks to @akramcodez.

- Added a **`doctor` diagnostic command** that checks your setup and reports common configuration problems. Thanks to @Dhirenderchoudhary. Closes #609.

- Added a **`retry` command** to re-run the last user turn. Thanks to @Dhirenderchoudhary. Closes #608.

- Added **message queueing while the agent is busy** so you can type ahead. Queued messages can be recalled before streaming, are truncated properly on narrow terminals, and no longer double-dispatch. Thanks to @Dhirenderchoudhary. Closes #597, #598.

- Added **estimated dollar cost tracking to `/usage`**, with a per-provider cost breakdown and a cumulative per-call cost history. Thanks to @rakshith1928. Closes #602.

- Added a **`--json` output flag** to the non-interactive plain run path. Thanks to @OMEE-Y.

- Added a **`diff_edit` tool for nano-profile models**. Thanks to @Dhirenderchoudhary. Closes #604.

- Added **automatic diagnostics after file edits**, surfacing errors introduced by an edit right away. Thanks to @2409324124. Closes #538.

- Added the **foundation for semantic memory** (storage layer and initial wiring), groundwork for upcoming memory features. Thanks to @Dhirenderchoudhary.

- Reworked the client to a **stateless API with history-boundary rehydration**, improving conversation reliability. Thanks to @akramcodez.

- Added a **Together AI provider template and docs**, and **MiniMax Coding now defaults to MiniMax-M3**. Thanks to @octo-patch. Added **Atomic Chat local provider configuration docs**. Thanks to @yanalialiuk.

- Fix: **`nanocoder.tune` loading and configuration precedence** from `agents.config.json` now resolve correctly. Thanks to @rakshith1928. Closes #648.

- Fix: **patch malformed SSE termination strings from providers**, preventing stream parsing errors. Thanks to @akramcodez. Closes #614.

- Fix: **bound slash command completions** so the menu no longer overflows. Thanks to @2409324124. Closes #624.

- Fix: **decouple console log verbosity from `NODE_ENV`** and quiet noisy LSP discovery logs. Thanks to @A-S-Manoj. Closes #606.

- Fix: **removed the `strip-ansi` runtime dependency**. Thanks to @2409324124. Closes #643.

- Docs: added a **Simplified Chinese README** and **Traditional Chinese** translations, with fixes to the Simplified Chinese copy, plus a star-history chart. Thanks to @2409324124, @jason1015-coder, and @zerone0x.

- Updated dependencies: `@ai-sdk/google`, `@ai-sdk/openai-compatible`, `undici`, `diff`, and `knip`.

- The **VS Code extension** saw major work this cycle (ACP process manager and handshake, a chat sidebar webview with tool-permission and diff UI, session persistence, and Tailwind styling). It is versioned separately from the CLI. Thanks to @akramcodez and @Dhirenderchoudhary.
