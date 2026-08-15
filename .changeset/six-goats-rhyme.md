---
"@nanocollective/nanocoder": patch
---

Add token usage block to the --plain --json run report. Downstream tooling consuming headless JSON output can now read input/output/total token counts per run, when the provider reports them. Closes #821.
