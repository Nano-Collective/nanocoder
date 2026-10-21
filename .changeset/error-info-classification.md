---
'@nanocollective/nanocoder': patch
---

Fixed structured error info labelling validation errors as network or timeout errors when the message happened to mention words like "connection" or "timeout". An error's name and Node error code still decide network and timeout errors on their own; message keywords now only count when the error is not a validation error. Closes #1136.
