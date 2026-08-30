---
"@nanocollective/nanocoder": patch
---

Fixed `nanocoder daemon logs` returning only a sliver of the tail when a single oversized log line runs past the start of the 64KB window. Realigning the window to the first line break discarded everything before it, so a log holding one long serialized payload came back as just the few bytes that followed. The tail now only realigns when a line break is near the start of the window, and otherwise keeps the partial first line.
