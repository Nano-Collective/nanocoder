---
"@nanocollective/nanocoder": patch
---

`web_search` now escapes markdown in result titles and descriptions, strips Brave's `<strong>` highlight tags, and collapses newlines so a snippet can no longer form a heading, a setext underline or a fake `## N.` result. Each URL is emitted as a single `<...>` autolink with whitespace and angle brackets removed, and results whose URL is not `http` or `https` no longer get a URL line. Previously a result containing `[text](url)`, backticks or newlines could spoof links and inject structure into the output the model reads. Closes #1146.
