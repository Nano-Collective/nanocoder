---
"@nanocollective/nanocoder": patch
---

The VS Code chat panel now shows the agent's queued work, not just what it has already done. Every tool call in a turn is announced before the batch runs, so the checklist reads queued → running → done, and rows are labelled in plain English ("Reading source/x.ts", "Running pnpm test") instead of raw tool names. File edits render as their own card with an Open Diff action again — the panel had been matching tool names the agent never sends, which made that card unreachable and left failed edits spinning forever. The task checklist is now scoped to the turn that produced it instead of one card reused for the whole session.
