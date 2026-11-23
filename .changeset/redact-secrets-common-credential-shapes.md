---
'@nanocollective/nanocoder': patch
---

Added redaction for common credential shapes in `redactSecrets` — Bearer headers, npm and Hugging Face tokens, AWS secret access keys, Azure Storage account keys, passwords in URLs, Twilio and SendGrid keys, and values of `PASS`/`PWD`/`CREDENTIAL`/`AUTH` environment variables. Secrets are masked while the surrounding scheme, field names and URL structure stay readable, and lookalike identifiers such as `AUTHOR` are left alone. Closes #2328. Thanks to @jslygljy.
