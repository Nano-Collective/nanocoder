---
'@nanocollective/nanocoder': patch
---

Model lookups no longer keep the whole models.dev database in memory. The cache now stores a compact index (id, name, limits, pricing and capability flags per model) instead of the ~10 MB pretty-printed payload, so the index loads faster and stays small for the life of the process, and lookups for a given name are memoized instead of rescanning every model. Context limits, pricing and image support resolve exactly as before. Existing cache files in the old format are ignored and refetched once. Closes #1782.
