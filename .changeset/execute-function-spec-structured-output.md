---
"@nanocollective/nanocoder": patch
---

Fixed the test suite failing on `main`. #1417 changed `execute_bash`'s execute function to return `{llmContent, isError}` instead of a bare string and updated its own spec, but `execute-function.spec.ts` calls the same function and asserted on the result directly. It passed `tsc` because it cast the result `as string` - the cast asserted away the very change that broke it, so the only thing left to catch it was a runtime `t.regex()` failure. The three `execute_bash` cases now read `llmContent` through a helper, and the `as string` casts are gone from the `read_file` cases too, so the next return-shape change fails at compile time rather than at assert time.
