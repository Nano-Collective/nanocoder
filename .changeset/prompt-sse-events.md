---
"@nanocollective/nanocoder": patch
---

Forward complete streamed events immediately instead of retaining their last characters until the provider sends another chunk. Keep repairing malformed DONE markers across chunk boundaries.
