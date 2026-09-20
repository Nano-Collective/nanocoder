---
"@nanocollective/nanocoder": patch
---

Fixed the `/settings` → Notifications panel dropping the `triggeredRunComplete` event. The panel seeded its fallback config with only three events and rendered a row for each, then wrote the whole object back on every toggle - so flipping any switch persisted a preference with no `triggeredRunComplete` key, and the daemon's "triggered run completed" notification silently stopped firing. The event now has a default and a row of its own. Also corrected the paste docs, which described the threshold as living under a `nanocoder.paste` namespace when it is read from the top-level `paste` key (the same error just fixed for `notifications`), documented the `triggeredRunComplete` event in both preference tables, and noted that the terminal bell needs the master Notifications toggle on and that tmux swallows the bell unless `monitor-bell` is enabled.
