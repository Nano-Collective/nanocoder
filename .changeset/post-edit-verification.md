---
'@nanocollective/nanocoder': minor
---

Add opt-in post-edit verification. Point `nanocoder.verification.command` at a check and Nanocoder takes a baseline of the repository immediately before the first file-content edit, re-runs the check once the turn's results are in, and reports the difference.

The baseline is what makes the output actionable. Everything the check reports as "introduced by your changes" is measured against the state before the edit, so a repository that was already failing is not handed to the model as something it just broke — the model is shown only the delta and is not sent off to rewrite unrelated code. Capturing it after the edit would blame it for every pre-existing failure.

Failures feed back to the model as a fix request, bounded by `retries.maxVerificationAttempts` (default `1`, which reports and never retries). A timeout, a command that cannot be found, and a cancelled run are terminal and never retried: there is no failure output to act on, so a fix request would only produce invention. An unchanged failure signature between attempts, or a set of new failures with none fixed, stops the loop early. Each retry replaces the previous instruction rather than appending to it, so the context being drained is not spent re-reading output the model was already given.

Commands are argv, not shell strings. A string form is tokenised and rejected if it contains shell metacharacters, so a project config cannot smuggle a pipeline or substitution through the check.

`/verify` runs the same command on demand without involving the model, for confirming a command resolves and produces useful output before letting it run after every edit. `/doctor` lists the configured command next to the hook and MCP commands, since a project-supplied `verification.command` names a command to execute and the directory-trust prompt is the only thing standing between a cloned repository and a command the user never inspected. The command is only ever spawned from the conversation loop, which does not exist until the directory is trusted.

Both the interactive and `--plain` runtimes are covered. Closes #1484.
