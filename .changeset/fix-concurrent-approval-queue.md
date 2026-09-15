---
"@nanocollective/nanocoder": patch
---

Fixed parallel subagents hanging the turn on the first approval prompt. The three "ask the user" slots each held a single resolver, so a second caller arriving before the first was answered overwrote it and that first promise could never settle. `tool-executor` starts up to five subagents in one turn and awaits them with `Promise.allSettled`, so one stranded caller meant the batch never resolved, the turn never ended, and Escape could not free it - the subagent was parked in an await that is not abort-aware, so recovery meant killing the process. Each slot now queues requests in arrival order and presents them one at a time, so every caller settles with its own answer. The same design backs `ask_user` and the main agent's tool confirmation, and both are fixed by the same change. Closes #1156.
