---
"@nanocollective/nanocoder": patch
---

Fixed multibyte terminal input being corrupted when an alternate-screen stdin chunk split a UTF-8 character, which could affect Korean and other IME input.
