---
'@nanocollective/nanocoder': patch
---

`/resume` and the session picker now switch to the resumed session's provider and model. Before, they only changed the provider and model labels and kept the current client, so replies still came from the previous model but were labelled, saved and recorded in `/stats` under the resumed one. If the session's provider is no longer configured, Nanocoder shows an error and stays on the current model, and the labels match it. Closes #1856.
