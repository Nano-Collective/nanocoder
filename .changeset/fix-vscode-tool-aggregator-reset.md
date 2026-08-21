---
"@nanocollective/nanocoder": patch
---

Fixed new tool calls landing back in an earlier card instead of a fresh one when a thought, reply, edit card, or plan update came in between. Closes #856.

Fixed a manually collapsed tool card re-expanding on its next update.

Reused one footer per agent turn instead of creating one per text segment.

Fixed a turn's copy button sometimes copying a newer turn's text instead of its own.
