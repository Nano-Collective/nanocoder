---
"@nanocollective/nanocoder": patch
---

Clamp web_search result limits to integers from 1 to 20 and show the normalized limit in result summaries. Reject non-numeric or non-finite limits before sending a request. Closes #2010.
