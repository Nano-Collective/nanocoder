---
'@nanocollective/nanocoder': patch
---

`nanocoder daemon install` now warns when the project isn't trusted yet. The installed service runs `nanocoder daemon start` unattended on a restart-on-failure policy, and `daemon start` refuses to boot outside a trusted directory - so installing auto-start before ever running nanocoder there produced a service that failed forever with no explanation, while install itself reported plain success. The result message now names both fixes: run `nanocoder` there once to accept the trust disclaimer, or pass `--trust-directory`.
