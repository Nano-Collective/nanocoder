---
"@nanocollective/nanocoder": patch
---

Keep shared cron jobs alive until every subscriber unregisters. `ScheduleEventSource.unregister()` used to stop the underlying job on the first call even when other subscriptions still used the same expression. Closes #1239.
