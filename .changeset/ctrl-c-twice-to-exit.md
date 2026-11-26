---
"@nanocollective/nanocoder": minor
---

In the chat, Ctrl+C no longer ends the session on the first press. While a response is running it cancels it, the same as Esc; with text in the prompt it clears it, and Ctrl+Z brings the text back. Otherwise it shows `Press Ctrl+C again to exit`, and only a second press within 2 seconds exits; any other key in between starts over. While watching a subagent (Ctrl+S), Ctrl+C cancels the running turn and returns to the chat. To exit straight away, press Ctrl+D in an empty prompt (new) or use `/exit`. `nanocoder run` and the directory trust prompt still exit on the first Ctrl+C. Thanks to @sszxt. Closes #2408.
