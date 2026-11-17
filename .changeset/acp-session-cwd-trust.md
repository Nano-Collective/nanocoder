---
"@nanocollective/nanocoder": patch
---

ACP now checks directory trust for each session's own folder, not only the folder `nanocoder --acp` was started in. A `session/new`, `session/load` or `session/resume` whose `cwd` is another, untrusted folder is refused with error code `-32003`, with `nanocoder/trustRequired` (`{cwd, status}`) in the error data. A client can then check and grant trust for that folder with `nanocoder trust --status` and `nanocoder trust --grant`. Before, a session could run tools and bash, and read the AGENTS.md, of any folder an editor named.
