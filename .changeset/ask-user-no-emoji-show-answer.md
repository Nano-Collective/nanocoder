---
"@nanocollective/nanocoder": patch
---

- **Removed emoji badges from the `ask_user` tool**. Questions no longer render a question-type emoji next to the prompt, and the tool schema no longer advertises them to the model.
- **`ask_user` now always shows the answer**. The tool result renders the full Question/Answer block even in compact tool display mode, instead of folding into the tool tally and hiding what was answered.
