---
"@nanocollective/nanocoder": patch
---

`fetch_url` no longer transfers the target page twice on every call. The redirect walk that validates each hop issued a GET, so when it reached a non-redirect it had already downloaded the whole final response - and then discarded it, because `convertToMarkdown` fetches the resolved URL itself. Every call therefore moved the target twice: doubled bandwidth, doubled rate-limit consumption, and two hits on any endpoint that meters or logs requests. The walk only ever needed a status and a `Location`, so it now asks for headers. A server that refuses HEAD (400, 403, 405, 501) or fails it outright still falls back to the GET-and-discard it used before, so nothing regresses on the servers that need it. Hop-by-hop validation is unchanged - a redirect into a private or loopback address is still rejected at the hop rather than followed.
