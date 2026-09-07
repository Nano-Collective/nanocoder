---
"@nanocollective/nanocoder": patch
---

Restored the `(default)` marker on the `/status` panel's Git line. Adding the git branch to the boot summary removed the `isDefault` case from the shared `formatGitStatusSummary` helper so the boot summary could render a bare `⎇ main`, but `/status` reads the same helper and silently lost its marker too. The shared helper reports every marker again and the boot summary drops the `default` one itself, which is the only place the shorter label was wanted.
