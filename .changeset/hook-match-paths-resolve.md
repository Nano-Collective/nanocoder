---
"@nanocollective/nanocoder": patch
---

Fixed lifecycle hooks with `matchPaths` not firing for some spellings of a path. The glob was matched against the path exactly as the model wrote it, so a `pre-tool-use` veto on `src/**` missed `./src/a.ts`, and missed `a.ts` after the model ran `cd src`. Paths are now resolved against the session cwd, the same way the file tools resolve them, and matched relative to the project root.
