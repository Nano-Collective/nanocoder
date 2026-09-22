---
"@nanocollective/nanocoder": patch
---

Fixed `find_files` returning no results for patterns written with a leading `./`. Project entries are relative paths with no `./` prefix, so `./src/**/*.ts` or `./package.json` was compared against `src/index.ts` and never matched, leaving the model to conclude the files did not exist. The prefix is now stripped before matching, and the basename fallback is computed from the stripped pattern so `./*.tsx` behaves exactly like `*.tsx`. Closes #1343.
