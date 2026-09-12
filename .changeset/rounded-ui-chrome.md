---
'@nanocollective/nanocoder': minor
---

Give every interactive surface the same rounded, titled chrome.

The prompt box now has rounded borders, and the surfaces that sit above it were inconsistent: some drew a bare title over unboxed content, others had no frame at all. The session selector (`/resume`, `/history`), the IDE selector (`/ide`), the file explorer (`/explorer`), the plan review bar, the question prompt and the tool confirmation prompt are now all enclosed in the same rounded titled box, at the same width, honouring the title shape you picked in `/settings`.

The transcript and the development mode indicator also line up with the prompt's left border instead of sitting a column off it, so the whole frame shares one vertical edge.
