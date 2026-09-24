---
"@nanocollective/nanocoder": patch
---

Fixed fast typing occasionally scrambling the prompt, for example `/tune` coming out as `/etun`, most often on the first command typed after startup. The input compared each echoed value only with its latest keystroke, so a render that ran late looked like an outside change and put the cursor back at the end of the older, shorter text.
