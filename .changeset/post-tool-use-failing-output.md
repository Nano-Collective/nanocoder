---
"@nanocollective/nanocoder": patch
---

Fixed `post-tool-use` hooks hiding their output from the model when they fail. A hook that exited non-zero was logged for the user and then dropped, so a passing linter or test run reached the model and a failing one never did. Failing output, stdout and stderr both, is now added to the tool result as `<hook-output event="post-tool-use" exit="N">`. The hook is still observe-only: the tool call succeeds, and a hook killed by a timeout or a signal is still only logged. Closes #1558.
