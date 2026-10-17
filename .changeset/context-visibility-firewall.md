---
"@nanocollective/nanocoder": minor
---

Implemented context-visibility firewall (issue #1573) to prevent blind edits. The agent now tracks exactly which lines of code it has read and mechanically blocks edits to lines it hasn't observed. This prevents small local models from making destructive edits based on hallucinated knowledge or file summaries.

**Key features:**
- Line-level visibility tracking: Records precise line ranges read via `read_file` and `search_file_contents`
- Edit validation: `string_replace` validates target lines are visible before allowing edits
- Overwrite protection: `write_file` requires reading entire file before overwriting existing files
- Compaction safety: Visibility receipts are invalidated after context compaction
- Subagent isolation: Each subagent maintains separate visibility state

**Technical changes:**
- Extended `read-tracker.ts` with visibility receipt system (line ranges, mtime/size tracking, generation-based invalidation)
- Updated `read-file.tsx` to record visibility for all returned content (full files, ranges, previews)
- Updated `search-file-contents.tsx` to record visibility for match lines and context
- Enhanced `string-replace.tsx` validator with line-level checks before edits
- Enhanced `write-file.tsx` validator to require full-file reads before overwrites
- Integrated with `auto-compact.ts` to clear receipts on compression
- Added comprehensive test coverage (30 test cases)

