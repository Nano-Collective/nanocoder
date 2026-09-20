---
"@nanocollective/nanocoder": patch
---

Fixed `--context-max` and `/context-max` silently accepting malformed values. `10kg` used to parse as `10` and `128kb` as `128`, so a typo quietly set a context limit nothing like the one you asked for. The value is now validated as a whole, and anything that is not a positive number with an optional `k`/`K` suffix is rejected with the existing error message. Values large enough to overflow to `Infinity` are rejected too, rather than being stored as a session limit. Thanks to @hiarun02. Closes #973.
