---
"@nanocollective/nanocoder": patch
---

Fixed `read_file` never rendering its metadata-only view. The formatter decided a response was metadata-only by testing `result.startsWith('File:')`, but the metadata branch emits `File Information for "..."`, so the test could never match. The same condition also required no line range and a file over the 1500-line preview threshold, neither of which applies — a `metadata_only` read returns before either is considered. As a result a `metadata_only: true` read was displayed as an ordinary content read: no "(metadata only)" marker, the content-read layout instead of the metadata layout, and a token count measured from the metadata block rather than the full file. Detection now keys off the request flag that actually selects the response shape.
