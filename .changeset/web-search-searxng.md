---
"@nanocollective/nanocoder": minor
---

`web_search` can use a SearXNG instance instead of the Brave Search API, with no API key. Set `nanocoderTools.webSearch.engine` to `"searxng"` and `baseUrl` to the instance; a `baseUrl` on this machine or a private network also needs `allowPrivateNetwork: true`. Project-level engine, endpoint, and private-network settings require directory trust approval again when changed. Malformed SearXNG responses explain how to enable JSON search. Brave stays the default, and existing configs are unchanged. The tool preview, the settings list and a new Web Search section in `/doctor` show the engine in use, or what is missing. Closes #2020.
