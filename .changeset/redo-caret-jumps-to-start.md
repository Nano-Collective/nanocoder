---
"@nanocollective/nanocoder": patch
---

Fixed the prompt caret jumping to the start of the text after a redo (Ctrl+Y), which sent the next keystroke to the front of the line - redoing "abcde" and typing "X" gave "Xabcde". TextInput only re-clamped the caret when the value shrank, so a redo that restored a longer value stranded the caret at the offset the preceding undo had clamped it to. Value replacements that come from outside the component - undo, redo, draft restore, a programmatic clear - carry no caret of their own, so the caret is now parked at the end of the restored text the way a fresh mount does. Mid-text typing is unaffected; the component still tracks its own edits and leaves the caret where it is.
