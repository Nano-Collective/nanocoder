---
"@nanocollective/nanocoder": patch
---

Bare `/expand` cuts each argument by terminal columns instead of UTF-16 code units. An emoji at the cut point no longer leaves half a surrogate pair (shown as a replacement character), and a CJK path no longer runs past the box and wraps, because each ideograph now counts as the 2 columns it takes. Fixes #1702.
