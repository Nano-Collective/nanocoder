---
"@nanocollective/nanocoder": minor
---

In the chat, Ctrl+C no longer ends the session on the first press. While a response is running it cancels it, including while a tool approval or a question is waiting; with text in the prompt it clears the text (attachments stay), and Ctrl+Z brings it back; in reverse history search it cancels the search. Otherwise it shows `Press Ctrl+C again to exit`, and only a second press within 2 seconds exits; any other key in between starts over. If a cancel is already under way, the next Ctrl+C goes straight to the exit hint, so a response that won't stop can't trap you. While watching a subagent (Ctrl+S), Ctrl+C cancels the running turn and returns to the chat. To exit straight away, press Ctrl+D in an empty prompt (new) or use `/exit`. `nanocoder run` and the directory trust prompt still exit on the first Ctrl+C. Thanks to @sszxt. Closes #2408.
