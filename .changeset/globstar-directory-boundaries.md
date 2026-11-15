---
'@nanocollective/nanocoder': patch
---

- Keep `**/` glob matches on directory boundaries so subscriptions, formatters and lifecycle hooks targeting `**/foo.ts` do not also run for `barfoo.ts`. Root-level and nested exact filenames continue to match. Closes #1935.
