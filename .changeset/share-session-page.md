---
"@nanocollective/nanocoder": minor
---

Added `/share`, which writes the current session to a single self-contained HTML page you can open in any browser or send to someone. Prompts, replies, reasoning and every tool call with its arguments and result are shown in order, with tool calls collapsed until clicked. The page runs no JavaScript and its Content-Security-Policy blocks all network requests; nothing is uploaded. Secrets are redacted by default (common token formats, secret-looking environment variables and configured provider API keys), and `--no-redact` turns that off. `/share --json` writes the same content as deterministic JSON. The system prompt and image data are left out. Closes #1485.
