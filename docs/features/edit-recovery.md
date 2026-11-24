---
title: "Edit Recovery"
description: "The evidence Nanocoder returns when an edit's search text does not match the file"
sidebar_order: 17
---

# Edit recovery evidence

When `string_replace` or a `diff_edit` SEARCH block cannot match the file,
Nanocoder returns bounded recovery evidence in the failed tool result. The agent
can inspect a likely target and retry with text copied exactly from the file.

The JSON payload contains:

- `version` and `reason` identifying the payload format and failure.
- `path` and, for `diff_edit`, the failing `blockNumber`.
- `status`: `candidate_found`, `ambiguous`, `no_candidate`, or `budget_exceeded`.
- Up to two candidate line ranges, a match category, difference notes, and
  `actualText` preserving original indentation and line endings.
- `nextAction` explaining how to proceed.

Matching tolerates leading/trailing whitespace, blank lines, and LF/CRLF
differences. Conservative fuzzy matching also considers small code differences
when multiple unchanged lines anchor the candidate. Matching is case-sensitive.
Similar targets are reported as ambiguous rather than choosing one arbitrarily.

Recovery provides evidence only: it never applies a fuzzy edit. A failed call
writes nothing, and the next edit must still match exactly and pass the usual
read-before-edit and approval checks.

Candidate bodies are omitted when they cannot fit the output budget or exceed
40 lines. Such candidates have `truncated: true`; the agent must read their line
ranges before retrying. Searches with fewer than 8 letter, digit, `_` or `$`
characters are too generic to place and return `no_candidate`. A search longer
than 40 lines or 8,000 characters, or a file larger than 1,000,000 characters,
returns `budget_exceeded` with no candidates; read the relevant range and retry
with a smaller search. Analysis is also bounded by comparison limits, and the evidence payload is
capped at 3,600 characters to leave room for the error heading. No additional
model calls or dependencies are required.
