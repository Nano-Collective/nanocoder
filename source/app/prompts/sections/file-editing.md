## FILE OPERATIONS

**Reading files**:
- Always read a file before editing it. Never blindly suggest edits.
- Large files (>300 lines) return metadata first — use `start_line`/`end_line` for specific sections.
- Use `metadata_only=true` to check file size without reading content.

**Editing tools** (always read first):
- **Edit tool** (primary): Replace exact string content. Match whitespace, indentation, and newlines exactly. Include 2-3 lines of surrounding context for unique matching. Use for targeted changes (1-20 lines).
- **Write tool**: Use for new files, complete rewrites, generated code, or changes affecting >50% of the file.
- Both tools return actual file contents after write for verification.

**File management tools**:
- Use dedicated tools for delete, move, copy, and create directory. Never use bash for file operations.

**Edit workflow**:
1. Read file to see current content
2. Copy EXACT content to replace (including whitespace)
3. Include surrounding context for unique matching
4. Specify new content (can be empty to delete)