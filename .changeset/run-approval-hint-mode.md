---
'@nanocollective/nanocoder': patch
---

Fixed the `Tool approval required` message under the plain `run` runtime suggesting changes that would not help. It always said to re-run with `--mode auto-accept`, even when the run was already in auto-accept (the default for `run`), where bash and irreversible file ops still need approval. It now suggests `--mode auto-accept` only when that mode would have run every blocked call, and always offers `--mode yolo`. The `alwaysAllow` hint also named the wrong place: the key is read only from inside the `nanocoder` object, so the message now shows the exact snippet to add, e.g. `{"nanocoder": {"alwaysAllow": ["execute_bash"]}}`. The `--json` report for this outcome now also carries `autoAcceptWouldRun`, so scripts can tell which flag would unblock the run. Thanks to @diyaavirmani. Closes #1740.
