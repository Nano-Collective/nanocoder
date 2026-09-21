---
"@nanocollective/nanocoder": minor
---

Added `nanocoder skills add`, an install path for skill bundles. Point it at an index name, `owner/repo`, any git URL, or a local checkout and it shallow-clones the bundle into a temp dir, strips `.git`, refuses any bundle containing a symlink, and validates it with the same linter `/skills check` runs — all before anything is written into the project. Because installing a skill means running its code, the trust prompt names every tool with its declared approval policy (`never` really does mean "runs without asking") and every event subscription the daemon would fire unattended. Accepting lands the bundle through the same copy `/skills promote` uses, so an existing skill is never overwritten without `--force`. Bare names resolve through a plain `skills.json` index hosted in a git repo — no registry service — overridable with `NANOCODER_SKILLS_INDEX` or `--index`. Refs #1163.
