---
"@nanocollective/nanocoder": patch
---

Warnings and errors now reach the log file. The shared logger used to stay on its console fallback for the whole process, so only the few app-startup lines were written to the file, and setting `NANOCODER_LOG_LEVEL` printed log lines to stdout instead, which broke `nanocoder run --json` output and ACP's JSON-RPC stream. Logs now go to the daily log file at the configured level and never to stdout; the Bun fallback logger writes to stderr. The last lines before the process exits are flushed so they are not lost.
