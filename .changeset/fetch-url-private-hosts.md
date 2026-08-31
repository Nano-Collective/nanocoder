---
'@nanocollective/nanocoder': patch
---

fetch_url now rejects the request URL inside execute, not only the validator. readOnly tools skip confirmation, so yolo/headless/subagents never ran the old hostname list. Blocks loopback CIDR, RFC1918, and GCP metadata names (`metadata`, `metadata.goog`, `metadata.google.internal`). HTTP redirects and DNS rebinding are not covered (#1089).
