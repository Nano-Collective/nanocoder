---
'@nanocollective/nanocoder': patch
---

fetch_url now blocks the whole `.localhost` zone, not just the bare `localhost` label. RFC 6761 reserves it for loopback and systemd-resolved resolves every label under it to 127.0.0.1, so `http://foo.localhost` reached a local service on Linux. Real hosts that merely contain the string (`localhost.example.com`) are unaffected.
