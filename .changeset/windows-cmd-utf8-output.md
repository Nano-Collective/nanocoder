---
"@nanocollective/nanocoder": patch
---

Fixed Windows command output turning accented letters, CJK text and other non-ASCII characters into replacement characters (`�`). `execute_bash` and custom tools now run cmd.exe with its console set to UTF-8, in a console of their own so the user's terminal keeps its code page. Closes #2344.
