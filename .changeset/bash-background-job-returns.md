---
"@nanocollective/nanocoder": patch
---

`execute_bash` no longer hangs on a command that starts a background job. A command such as `npm run dev &` or `sleep 100 &` kept the tool waiting until the background job exited, because the job held the command's output pipes open. The tool now returns once the shell itself exits and its output has drained, and the background job keeps running (it is still stopped when Nanocoder exits).
