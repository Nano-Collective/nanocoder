---
'@nanocollective/nanocoder': patch
---

Fix unauthenticated cross-origin access to the VS Code companion WebSocket.

The companion server bound to a fixed loopback port (`51820`) and accepted every upgrade, so any local process or browser tab could deliver `{"type":"send_prompt", ...}` straight into a running agent and read every broadcast the server pushed out. This made prompt-injection and file-content exfiltration possible on any developer machine that had a session open.

Three changes close the hole:

1. The server now mints a 256-bit bearer token at startup and only accepts WebSocket upgrades that present it as `?token=...`. The comparison is constant-time.
2. Any upgrade carrying an `Origin` header is rejected before the handshake completes. The legitimate extension is a Node `ws` client and never sends one, so closing that door costs nothing and shuts out browsers specifically.
3. The server binds to an ephemeral port by default and publishes `{port, token, pid, cliVersion, startedAt}` to `~/.config/nanocoder/vscode-server.json` (mode 0600). The `--vscode-port` flag remains available for users who need a fixed port (SSH forwarding, etc.); in that mode the discovery file is still written so the extension can pick up the token automatically.

The VS Code extension (`plugins/vscode`) now reads the discovery file to learn the port and token instead of trusting `nanocoder.serverPort`. The legacy setting is still honoured as a fallback if the discovery file is missing or stale, but the token-less handshake will be refused by the new server, so the connection cannot succeed by accident.
