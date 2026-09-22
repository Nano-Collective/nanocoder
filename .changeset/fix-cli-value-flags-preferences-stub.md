---
'@nanocollective/nanocoder': patch
---

Fixed the `cli-value-flags` integration tests failing on `main`. The suite's
module loader short-circuits `@/config/preferences` with a stub, and `cli.tsx`
started importing `getAlternateScreen` and `getMouseReporting` from it while
that stub still exported only `loadPreferences`. Both changes passed on their
own branches and only collided once merged, so the missing exports surfaced as
`getMouseReporting is not a function` across all 30 cases.
