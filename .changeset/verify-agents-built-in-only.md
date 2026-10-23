---
"@nanocollective/nanocoder": patch
---

`nanocoder verify` and the daemon's CI investigation now always run the built-in `verify-pr-review` and `verify-ci-investigator` agents. Previously a project-level `.nanocoder/agents/` file with the same name replaced them, so a pull request could add its own reviewer and write its own review.
