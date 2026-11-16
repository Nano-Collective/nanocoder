---
"@nanocollective/nanocoder": patch
---

Daemon skill subscriptions on the same event now run side by side instead of one after another. Previously the second subscription waited for the first one's whole agent run, and one that threw skipped the rest. A failing subscription is now logged on its own without affecting the others, and a throw on a cron tick or a debounced file change no longer surfaces as an unhandled rejection in the daemon. The per-subscription concurrency cap is unchanged.
