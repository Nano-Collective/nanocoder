---
"@nanocollective/nanocoder": minor
---

Added completion evidence. Set `nanocoder.verify.required` to commands such as `["pnpm test"]`, or to `"auto"` to use the `test`, `typecheck` and `lint` scripts in `package.json`, and a turn that edited files is no longer accepted as finished until each command has run through `execute_bash` and exited 0 after the last edit. If the model tries to finish without that, it is sent back to run them (at most twice per task). A passing run followed by another edit has to be repeated, a failed run never counts, and a pipe, `;` or `||` that could hide the real exit code does not count. The final response ends with a `Verification:` line listing each command and its exit code. Works in the interactive UI, `nanocoder run`, and the VS Code extension. Off by default. Closes #1583.
