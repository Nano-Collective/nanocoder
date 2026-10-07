---
title: "Tool Output Conventions"
description: "How file-content tools represent file contents in the responses they hand back to the model"
sidebar_order: 13
---

# Tool output conventions

File-content tools use different model-facing representations depending on what the model needs from the response.

## read_file

`read_file` returns raw file content without line numbers. This keeps the payload clean for content-based editing and makes it the canonical representation for exact text matching.

## Edit tools

Bounded edit-tool responses, such as `string_replace` and `diff_edit`, return partial file windows. Those responses should keep line numbers because the excerpt needs to be placed inside the larger file.

When an edit tool returns file content:

- Include a header such as `Updated file context (lines X-Y of N)`.
- Use absolute file line numbers, not window-relative offsets.
- Keep omission markers aligned with absolute line numbers.

## write_file

`write_file` deliberately returns no file content at all. The model supplied the content in the call arguments, so echoing it back only spends tokens on something the model already has. The response is stats only: whether the file was created or overwritten, plus line, character, and estimated token counts.

## UI display

Line numbers rendered by the terminal or editor UI are presentation-only unless the tool intentionally returns a bounded, line-addressed excerpt.
