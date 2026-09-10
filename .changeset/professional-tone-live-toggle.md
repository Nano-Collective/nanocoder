---
"@nanocollective/nanocoder": patch
---

Professional Tone now applies as soon as you toggle it in `/settings`. Previously the completion note changed immediately but the system prompt's TONE section waited for the next mode or model switch, so the model kept its old register and the toggle looked broken. `buildSystemPrompt` also takes `professionalTone` as an explicit argument instead of reading the preference file itself.
