---
"@nanocollective/nanocoder": patch
---

Fixed the `/schedule` description of step and six-field cron expressions. `*/15 * * * *` now reads as every 15 minutes, `0 */2 * * *` as every 2 hours, and a leading seconds field no longer shifts the remaining fields (`0 0 9 * * *` reads as daily at 9:00).
