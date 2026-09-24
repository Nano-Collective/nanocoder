---
"@nanocollective/nanocoder": patch
---

Fixed the last row of a markdown table being left outside the rendered table as raw `| a | b |` text whenever the table ended the reply, which is common. The table pattern required a newline after every row, and replies are trimmed.
