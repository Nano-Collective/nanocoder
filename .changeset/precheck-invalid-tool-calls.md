---
"@nanocollective/nanocoder": patch
---

In the main conversation, a tool call that fails its schema or validator is rejected before the approval dialog. The model receives the validation error as the tool result, and the chat shows a one-line notice instead of asking you to approve a call that cannot run. The turn stays busy while that check runs, and cancelling it stops the wait and cancels that call plus every later call in the turn.
