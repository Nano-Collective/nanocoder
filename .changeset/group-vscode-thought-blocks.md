---
"@nanocollective/nanocoder": patch
---

Grouped the VS Code extension's streamed thoughts into a single expandable section per response instead of one dropdown per thought block. Thoughts interrupted by answer text or tool calls now resume in the same section, separated by a blank line, and the header reports the total time spent reasoning ("Thought for 12s") rather than one short duration per fragment. The section still auto-expands while thoughts stream and collapses when they stop, but stops doing so once the user toggles it by hand. Closes #854.
