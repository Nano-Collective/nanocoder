---
"@nanocollective/nanocoder": patch
---

Clamp web_search result limits to integers from 1 to 20 and show the normalized limit in result summaries. Accept non-empty numeric strings and use the default of 10 for omitted or null limits; reject blank, non-numeric, and non-finite limits before sending a request. Closes #2010.
