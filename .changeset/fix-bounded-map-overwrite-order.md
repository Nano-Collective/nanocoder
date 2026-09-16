---
"@nanocollective/nanocoder": patch
---

Fix `BoundedMap.set` not bumping an existing key's access order on overwrite. A frequently-overwritten key kept its original (oldest) insertion position and could be evicted before newer entries; overwrite now moves the key to most-recent, matching the intended LRU eviction order. Thanks to @MsfPablo. Closes #1143.