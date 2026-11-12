---
"@nanocollective/nanocoder": patch
---

`/repomap` now maps the project root instead of the process working directory, so it shows the right project in ACP sessions. It also checks each file's size before reading it, so large generated or vendored files are skipped without being read in full, and `maxFileBytes` now counts bytes rather than characters. Cron labels in `/schedule` and skill subscriptions no longer garble lists: `0,30 9 * * *` now reads "daily at 9:00, 9:30" instead of "daily at 9:0,30", and hour or minute ranges such as `0 9-17 * * *` show the raw expression instead of a wrong time.
