---
"@nanocollective/nanocoder": patch
---

Fall back to CLAUDE.md, GEMINI.md, .github/copilot-instructions.md and .cursorrules when a project has no AGENTS.md, with a configurable user-level `nanocoder.instructionFiles` list. Instruction files are now constrained to safe in-project files, capped like tool output, and shared by the prompt builder, `/status` and `/doctor`. Closes #2265.
