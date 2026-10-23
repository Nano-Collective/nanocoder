---
"@nanocollective/nanocoder": patch
---

`read_file` no longer answers "unchanged since last read" after the earlier read has left the context. The compact-and-retry that runs after repeated empty model turns compressed old file bodies without invalidating read stubs, and the message cap (`maxMessages`) could drop an old read while its stub entry lived on, so a model asking for a file again got a pointer to content it could no longer see. The retry compaction now invalidates stubs like `/compact` does, and the cap forgets the stub for each dropped read unless a fresh copy of the same read is still in the window.
