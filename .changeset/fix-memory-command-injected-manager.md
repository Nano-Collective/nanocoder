---
"@nanocollective/nanocoder": patch
---

Fix `/memory accept` writing accepted proposals to a detached default store when `options.memoryManager` is provided to `createMemoryCommand`. The command now correctly binds `SummarizerService` to the injected memory manager. Closes #1713.
