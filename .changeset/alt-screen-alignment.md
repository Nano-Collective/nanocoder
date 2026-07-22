---
"@nanocollective/nanocoder": patch
---

- Fixed static vs. live content misalignment in `--alt-screen` (fullscreen) mode. The chat transcript and the input/tools footer now share the same left column, so assistant messages, tool results, and the input line up cleanly. The fix moves the footer out to the transcript's padded column rather than pushing the transcript into the scroll viewport's clip window (which was clipping the first character of each line).
