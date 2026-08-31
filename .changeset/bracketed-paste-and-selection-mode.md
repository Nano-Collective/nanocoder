---
'@nanocollective/nanocoder': minor
---

Fix multi-line paste submitting the prompt partway through, and add a selection mode for fullscreen.

Nanocoder never enabled bracketed paste, so the terminal delivered a paste as bare bytes and the carriage return at each line break reached Ink's keypress parser as Enter. Pasting two lines sent the first line to the model and left the second in the input box. Paste handling relied entirely on heuristics (input rate, size, line count) that only ever saw text which had already made it into the buffer.

DECSET 2004 is now enabled in both screen modes. Paste payloads are lifted off stdin before Ink sees them and delivered to the input as a single event, so a pasted newline can no longer submit. The old heuristics remain as a fallback for terminals without bracketed paste support.

Fullscreen mode (`--alt-screen`) enables mouse reporting for wheel scrolling, which takes click-drag text selection away from the terminal. **Ctrl+P** now toggles selection mode, suspending mouse reporting so you can select and copy normally, and resuming it on the next press. Inline mode, the default, never enables mouse reporting and is unaffected.
