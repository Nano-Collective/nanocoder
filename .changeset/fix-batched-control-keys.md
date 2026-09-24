---
"@nanocollective/nanocoder": patch
---

Fixed control keys that arrive in one read (a held Backspace, a double Ctrl+Z, keys typed while the UI is busy) doing nothing and being inserted into the prompt as raw bytes that were then sent to the model. Each control key is now handed to the input handlers separately.
