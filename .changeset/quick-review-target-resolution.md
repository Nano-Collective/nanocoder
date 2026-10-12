---
"@nanocollective/nanocoder": patch
---

Fix quick review for forks: resolve PR numbers across configured remotes and their fork parents, accept explicit GitHub PR URLs, treat renamed repositories as one, and pin `gh` lookups to github.com. Branch reviews now diff against the upstream base instead of local `main`, and the result renders as a normal assistant message with the reviewed scope and any omitted diff lines. Extra target arguments are rejected. Part of #1287.
