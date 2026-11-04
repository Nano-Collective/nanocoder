---
'@nanocollective/nanocoder': patch
---

Long queued-message previews no longer wrap onto a second row. The preview was truncated against the full terminal width, but it renders inside the prompt box, which is narrower once its margin, border and padding are taken off, so the ellipsis or image count spilled onto the next line. It is now budgeted against the box it actually renders in, for both ASCII and CJK text.
