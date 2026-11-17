---
"@nanocollective/nanocoder": patch
---

Generate the VS Code chat panel's CSP script nonce with `crypto.randomBytes` instead of `Math.random`, so the nonce that keeps injected markup from running script in the webview cannot be predicted.
