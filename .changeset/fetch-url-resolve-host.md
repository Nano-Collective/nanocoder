---
"@nanocollective/nanocoder": patch
---

`fetch_url` now looks up the address behind a hostname and refuses it when any resolved address is loopback, private, link-local or a cloud-metadata address. Previously only the hostname text and IP literals were checked, so a public DNS name that points inward (for example `localtest.me` or `169.254.169.254.nip.io`) could reach internal services without a prompt. The check runs on the first URL and on every redirect hop.
