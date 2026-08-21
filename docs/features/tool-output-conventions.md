# Tool output conventions

File-content tools use two different model-facing representations.

## read_file

`read_file` returns raw file content without line numbers. This keeps the payload clean for content-based editing and makes it the canonical representation for exact text matching.

## Edit tools

Bounded edit-tool responses, such as `string_replace` and `diff_edit`, return partial file windows. Those responses should keep line numbers because the excerpt needs to be placed inside the larger file.

When an edit tool returns file content:

- Include a header such as `Updated file context (lines X-Y of N)`.
- Use absolute file line numbers, not window-relative offsets.
- Keep omission markers aligned with absolute line numbers.

## UI display

Line numbers rendered by the terminal or editor UI are presentation-only unless the tool intentionally returns a bounded, line-addressed excerpt.
