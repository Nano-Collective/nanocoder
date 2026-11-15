---
"@nanocollective/nanocoder": patch
---

`fetch_url` and the browser tool now refuse IPv6 addresses that carry an internal IPv4 address: IPv4-compatible (`[::127.0.0.1]`), IPv4-translated (`[::ffff:0:7f00:1]`), NAT64 (`[64:ff9b::7f00:1]`) and 6to4 (`[2002:7f00:1::]`) forms, alongside the IPv4-mapped form that was already blocked. The embedded address is checked like any other IPv4 address, so the same forms around a public address still work. They also refuse the reserved IPv4 ranges 192.0.0.0/24, 198.18.0.0/15, 224.0.0.0/4 (multicast) and 240.0.0.0/4 (which includes 255.255.255.255). The check applies to URLs and to the addresses a hostname resolves to. Closes #1942.
