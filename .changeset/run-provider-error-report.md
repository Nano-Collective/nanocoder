---
'@nanocollective/nanocoder': patch
---

Fixed `nanocoder run` losing its report when a provider request fails partway through, for example with an HTTP 500 or a dropped connection after a tool had already run. With `--json`, stdout was empty, so CI got no report and no record of the tool calls that had run, and in both `--json` and text mode the `session-end` hook never fired. The failure now ends the run with the usual `"error"` report, including the tool calls captured before it, and the run still exits 1. Any other fatal error after the session has started now also exits through graceful shutdown, so `session-end` still runs. Thanks to @diyaavirmani. Closes #1835.
