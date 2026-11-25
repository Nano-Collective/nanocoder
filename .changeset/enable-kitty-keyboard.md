---
"@nanocollective/nanocoder": patch
---

Ask the terminal for the kitty keyboard protocol on startup (Ink's `kittyKeyboard` auto mode), so Shift+Enter inserts a newline out of the box in terminals that implement it — kitty, WezTerm, and Ghostty. Terminals that do not answer the protocol query are unaffected. The negotiation is configurable via the new `kittyKeyboardMode` preference (`"auto"` default, plus `"enabled"` for terminals whose reply is eaten by an ssh-style transport, and `"disabled"` to write no protocol bytes at all).
