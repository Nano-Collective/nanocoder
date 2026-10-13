---
"@nanocollective/nanocoder": minor
---

A failing test or type-check run that is too long to pass to the model whole now reaches it as a failure capsule instead of a head-and-tail cut, which used to drop the failure detail printed in the middle of the log. Nanocoder recognises Jest, Vitest, Mocha, AVA and `tsc` output, keeps each failing test's title, location, assertion and expected/received diff, and narrows the original command to the first failing test (for example `npm test -- jest/auth.test.js -t '...'`). It re-runs that narrow command once to report whether the failure reproduces on its own. Only plain runner invocations are narrowed or re-run; `!command` input is distilled but never re-run; short or unrecognised output is unchanged. Closes #1584.
