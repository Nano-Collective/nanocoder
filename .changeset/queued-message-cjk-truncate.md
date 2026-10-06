---
'@nanocollective/nanocoder': patch
---

Queued-message previews, the session label, the active-editor filename, and session titles no longer wrap onto extra rows when the text is CJK or contains emoji. The shared truncate helper budgeted in UTF-16 code units while its callers pass a column count, and a double-width CJK ideograph or emoji is one code unit but two terminal columns, so a "truncated" line could render at roughly twice its intended width. It now truncates by actual terminal column width via `cli-truncate`, so a queued message stays on a single row regardless of script. Closes #1531.
