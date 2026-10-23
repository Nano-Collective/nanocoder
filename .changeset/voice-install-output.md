---
"@nanocollective/nanocoder": patch
---

Installing voice dependencies no longer writes over the chat UI. Homebrew, apt, cmake and make ran with the terminal attached, so their output drew straight across the Ink interface. Their output is now captured, and when a step fails the error shows the last lines of it.
