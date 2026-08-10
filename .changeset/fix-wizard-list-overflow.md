---
"@nanocollective/nanocoder": patch
---

Fixed the provider wizard appearing to hang after picking models. Finishing model selection with `d` returned to the raw provider template list, where the only way to proceed was scrolling past every template to a trailing "Done & Save" — a ~34-row screen that overflows a normal terminal, so the entry was off screen and the wizard looked stuck. Adding a provider now lands on the wizard's root menu, which offers "Done & Save" up front, and the template, edit, and MCP server lists scroll within the terminal height instead of overflowing it.
