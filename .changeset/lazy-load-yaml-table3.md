---
'@nanocollective/nanocoder': patch
---

Lazy-load `yaml` (72 modules) and `cli-table3` (11 modules) so they no longer load on every start: YAML parsing now happens on the first frontmatter block, and the table renderer loads `cli-table3` on the first markdown table, for projects that never use either.
