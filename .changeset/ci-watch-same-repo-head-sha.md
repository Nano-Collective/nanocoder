---
"@nanocollective/nanocoder": patch
---

CI watch no longer acts on another repository's failure. `gh run list --branch main` also matched pull requests from forks whose branch is named `main`, so the daemon could investigate, and at `auto-fix` / `full-commit` try to fix, a commit that was never on origin. Pull-request runs whose head repository is a fork are now skipped. The fix clone also starts from exactly the failing run's commit: `auto-fix` branches from it, and `full-commit` refuses to run if origin's branch has moved past it.
