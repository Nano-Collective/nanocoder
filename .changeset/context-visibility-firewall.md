---
"@nanocollective/nanocoder": minor
---

Implemented context-visibility firewall (issue #1573) to prevent blind edits. The agent now tracks exactly which lines of code it has read and mechanically blocks edits to lines it hasn't observed. This prevents small local models from making destructive edits based on hallucinated knowledge or file summaries.

**Key features:**
- Line-level visibility tracking: Records precise line ranges read via `read_file` and `search_file_contents`
- Edit validation: `string_replace` and `diff_edit` validate target lines are visible before allowing edits
- Overwrite protection: `write_file` requires reading entire file before overwriting existing files
- Compaction safety: Visibility receipts are invalidated after context compaction
- Subagent isolation: Each subagent maintains separate visibility state
- External change detection: Tracks mtime/size to detect file modifications
- CRLF normalization: Consistent line counting across Windows and Unix line endings

**Technical changes:**
- Extended `read-tracker.ts` with visibility receipt system (line ranges, mtime/size tracking, generation-based invalidation, CRLF normalization)
- Updated `read-file.tsx` to record visibility for all returned content (full files, ranges, previews)
- Updated `search-file-contents.tsx` to record visibility for match lines and context (fixed path resolution to use search cwd)
- Enhanced `string-replace.tsx` validator with line-level checks before edits
- Enhanced `diff-edit.tsx` validator with line-level checks for all SEARCH blocks
- Enhanced `write-file.tsx` validator to require full-file reads before overwrites
- Integrated with `auto-compact.ts` to clear receipts on compression
- Added comprehensive test coverage (32 test cases including CRLF handling)
- Removed unused contentHash parameter and _simpleHash function (mtime/size detection is sufficient)

