---
"@nanocollective/nanocoder": patch
---

Fix `formatCronHuman` leaking raw cron syntax for `*/N` minute expressions. `*/5 * * * *` rendered verbatim as "every hour at minute */5"; it now renders as "every 5 minutes". Thanks to @MsfPablo. Closes #1132.