# Smoke Test — Session Artifact Lifecycle (PR #826)

Manual checks for the plan / task / walkthrough artifact feature. Everything here is behaviour that unit tests cannot reach: the interactive loop, the webview, and the merge points where `main` had moved.

Delete this file before merging if you do not want it in the tree.

## Setup

```bash
pnpm run build
pnpm run build:vscode          # only needed for the extension section
```

Use a scratch project, not this repo, for anything that edits files.

Artifacts live at:

- macOS `~/Library/Application Support/nanocoder/artifacts/<session id>/`
- Linux `~/.local/share/nanocoder/artifacts/<session id>/`

Handy watch command:

```bash
watch -n1 'ls -la ~/Library/Application\ Support/nanocoder/artifacts/*/'
```

---

## A. CLI — plan lifecycle

The core flow. Highest value if you only have time for one section.

- [ ] **A1 Plan is produced and saved.** Shift+Tab to Plan Mode, ask for a small multi-file change. When the turn ends, a review prompt appears and an `Artifacts:` row shows a **Plan** link above the input.
- [ ] **A2 Plan link opens.** Cmd/Ctrl+click **Plan**. `implementation_plan.md` opens and contains the plan you just saw.
- [ ] **A3 Approve executes.** Choose *Yes, execute this plan*. Mode flips to normal and implementation starts immediately, without you retyping anything.
- [ ] **A4 The plan is actually attached.** The request that starts implementation contains the plan text, not just "the plan above is approved". Check with `/debug` or the logs if unsure — this is what makes it work on models with small context.
- [ ] **A5 Revise keeps Plan Mode.** Re-enter Plan Mode, generate a plan, choose *No, tell Nanocoder what to change*. You stay in Plan Mode and can ask for changes.
- [ ] **A6 Esc is safe.** Same setup, press Esc. Same as *No* — you must never silently leave Plan Mode.
- [ ] **A7 Ask more works.** Choose *Ask me clarifying questions*. The model asks questions and you stay in Plan Mode. (This option was removed by the PR and restored — worth confirming it is wired up.)
- [ ] **A8 Walkthrough is recorded.** After A3 finishes, a **Walkthrough** link appears. Open it: files changed, tests, and verification steps. Confirm the tests listed were actually run and it did not invent any.
- [ ] **A9 Prose-plan fallback.** Use a small local model that will not reliably call tools (or `/tune` → nano). Plan something. Even with no `write_plan` call, a plan is still saved and the review prompt still appears.
- [ ] **A10 Approval never dead-ends.** Delete `implementation_plan.md` from the session directory while the review prompt is on screen, then approve. It must proceed anyway, referring to the plan in the transcript — not show an error and leave you stuck.

## B. CLI — tasks

- [ ] **B1 Nothing lands in your project.** Run a multi-step task that makes the AI build a task list. Confirm **no `.nanocoder/tasks.json`** is created anywhere in the project. `git status` stays clean of it.
- [ ] **B2 Tasks link.** The **Tasks** shortcut opens `task.md` with checkboxes matching the live panel.
- [ ] **B3 Manual commands.** `/tasks add something`, `/tasks`, `/tasks remove 1`, `/tasks clear` all behave, and still write nothing into the project.
- [ ] **B4 `/tasks` before any message.** Start nanocoder, run `/tasks add first` as the very first thing. It works and creates a session directory (this used to fall back to the project directory).
- [ ] **B5 `/clear` starts fresh.** With tasks present, `/clear`, then `/tasks`. The list is empty.
- [ ] **B6 The old session kept its record.** `/resume` the pre-`/clear` session. Its tasks come back.

## C. CLI — sessions

- [ ] **C1 Resume restores artifacts.** Complete A1–A8, quit, `nanocoder --continue`. The `Artifacts:` row returns with all three links and they open.
- [ ] **C2 History is clean.** In that resumed session, scroll the replayed transcript. There must be **no** `<nanocoder-internal-walkthrough>` message and no raw `<approved_plan>` block shown as if you typed it.
- [ ] **C3 Session title is sensible.** The resumed session is titled after something you actually typed, not "The implementation plan below is approved…".
- [ ] **C4 Delete removes artifacts.** Delete that session from `/resume`. Its `artifacts/<session id>/` directory is gone.
- [ ] **C5 Permissions.** `ls -l` a session artifact directory: `700` on the directory, `600` on the files.

## D. CLI — isolation and edge cases

- [ ] **D1 Subagent cannot write.** Ask the AI to use the `explore` subagent to modify a file. It must refuse with "not available to this subagent" rather than writing it. (`explore` declares read-only tools; this used to be bypassable.)
- [ ] **D2 Subagent cannot touch artifacts.** Ask a subagent to update the task list or write a plan. Same refusal, and your existing `task.md` / `implementation_plan.md` are unchanged.
- [ ] **D3 Cancel mid-turn.** Approve a plan, then hit Esc partway through implementation. No walkthrough nudge fires, and the **next** message in the same session works normally — no "Internal error", no missing tool result.
- [ ] **D4 Tune profiles.** `/tune` → `nano`. Plan Mode still produces a plan and the review prompt still appears. Expect **no** task list and **no** walkthrough on that profile — that is intended for now, but confirm it degrades silently rather than erroring.
- [ ] **D5 Headless leaves nothing.** `nanocoder --plain "add a comment to README"` in a scratch repo. No `.nanocoder/` directory, and no leftover directory under `artifacts/` once it exits.
- [ ] **D6 Headless is not slowed down.** A `--plain` run does not spend an extra model turn producing a walkthrough nobody sees.

---

## E. VS Code extension

Install `assets/nanocoder-vscode.vsix`, or run the Extension Host from `plugins/vscode`.

- [ ] **E1 Plan card appears.** Switch to Plan Mode in the panel, ask for a change. When the turn ends you get an "Implementation plan ready" card.
- [ ] **E2 Open the plan.** *Open implementation_plan.md* opens the file in an editor tab.
- [ ] **E3 Approve shows a user turn.** Click *Yes, execute this plan*. A user bubble appears in the transcript before the response starts — the turn must not appear to begin from nowhere. (Regression-prone: approval bypasses the normal send path.)
- [ ] **E4 Revise.** Generate another plan, click *No, tell Nanocoder what to change*. The card clears, the composer is usable, and you are still in Plan Mode.
- [ ] **E5 Approval failure is visible.** Delete the plan file, then approve. You get a message in the transcript, not only a toast, and the send button resets.
- [ ] **E6 Artifact bar.** All three buttons appear above the composer once the artifacts exist, and each opens the right file.
- [ ] **E7 New chat clears.** Command palette → Nanocoder: New Chat. The artifact bar disappears.
- [ ] **E8 Resume restores.** Resume the completed session. All three shortcuts come back, **and** the mode and model selectors show the right values (these were not being re-read on resume before).
- [ ] **E9 Queue a follow-up.** While a response is streaming, type another message and press Enter. It must be accepted and appear in the transcript — not silently swallowed. (This regressed in the PR and was reverted; worth confirming.)
- [ ] **E10 Cancel is not an error.** Start a long turn, press Stop. You get a cancelled state, **not** a red "Nanocoder prompt failed" error toast.
- [ ] **E11 Allow → immediate Stop.** Approve a tool and hit Stop in the same beat. The session survives and the next message works.

---

## Known and expected

- `write_tasks` and `write_walkthrough` are absent under the `minimal` and `nano` tune profiles. Deliberate for now — see D4.
- Daemon-triggered skill runs have no session, so they cannot track tasks. They previously wrote into the project directory.
- Terminals without OSC-8 hyperlink support show the artifact labels as plain text with no clickable link.
- `source/tools/read-file.spec.tsx` and the `location-step` wizard test fail locally on `main` too. Not caused by this work.
