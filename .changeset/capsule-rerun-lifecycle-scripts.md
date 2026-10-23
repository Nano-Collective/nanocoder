---
"@nanocollective/nanocoder": patch
---

The automatic narrowed re-run after a failing test command no longer repeats `pre` and `post` package scripts. Re-running `npm test` or `npm run <script>` to isolate the first failure also ran hooks such as `pretest` or `posttest`, which can build, lint or upload coverage, without the user seeing it. When the script has such hooks, npm re-runs now pass `--ignore-scripts`, which in npm 7 and later skips only the hooks. pnpm rejects that flag on `run` and yarn 1 ignores it, so for those a script with hooks is no longer re-run automatically, and the capsule shows the original command to reproduce. Direct runner calls such as `npx jest` are unchanged.
