---
"@nanocollective/nanocoder": patch
---

Ctrl+R reverse search no longer crashes when the prompt history file holds unexpected entries. A history file that was valid JSON but contained `null`, numbers or bare strings was loaded as-is, and searching it threw. Bare strings are now upgraded to normal entries on load, anything else unusable is dropped, and the search skips malformed entries defensively.
