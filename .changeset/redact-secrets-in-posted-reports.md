---
"@nanocollective/nanocoder": patch
---

Mask likely secrets before Nanocoder posts to GitHub. The CI investigation comment, the auto-fix draft PR body and the `nanocoder verify --post-review` review are written from CI logs and PR diffs that an attacker can control, so they now pass through a redaction step that replaces common token formats (GitHub, OpenAI and Anthropic style keys, AWS access key ids, Slack tokens, PEM private keys) and the values of environment variables whose names contain TOKEN, KEY, SECRET or PASSWORD.
