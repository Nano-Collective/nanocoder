---
"@nanocollective/nanocoder": patch
---

Fixed the `fetch_url` SSRF guard missing private IPv4 addresses carried in IPv6 spellings: `::/96` (IPv4-compatible), NAT64 `64:ff9b::/96`, 6to4 `2002::/16`, and `::ffff:0:0/96` (IPv4-translated) now have their embedded address checked against the private-range list, so e.g. `http://[::127.0.0.1]/` is rejected. Also blocked the remaining non-public IPv4 ranges (192.0.0.0/24, 198.18.0.0/15, multicast, and 255.255.255.255). Thanks to @dhruvil-codes. Closes #1942.
