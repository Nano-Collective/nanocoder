---
'@nanocollective/nanocoder': patch
---

Fix unauthenticated cross-origin access to the VS Code companion WebSocket.

The companion server bound to a fixed loopback port (`51820`) and accepted every upgrade, so any local process or browser tab could deliver `{"type":"send_prompt", ...}` straight into a running agent and read every broadcast the server pushed out. This made prompt-injection and file-content exfiltration possible on any developer machine that had a session open.

Three changes close the hole:

1. The server now mints a 256-bit bearer token at startup and only accepts WebSocket upgrades that present it in an `Authorization: Bearer <token>` header (constant-time comparison). The token is never placed in the URL, where it would show up in browser bars, proxy logs and any other intermediary that happens to inspect the request line.
2. Any upgrade carrying an `Origin` header is rejected before the handshake completes. The legitimate extension is a Node `ws` client and never sends one, so closing that door costs nothing and shuts out browsers specifically.
3. The server binds to an ephemeral port by default and publishes `{port, token, pid, cliVersion, startedAt}` to `<configDir>/vscode-server.json` (mode 0600). The `--vscode-port` flag remains available for users who need a fixed port (SSH forwarding, etc.); in that mode the discovery file is still written so the extension can pick up the token automatically.

The VS Code extension (`plugins/vscode`) now reads the discovery file to learn the port and token instead of trusting `nanocoder.serverPort`. For SSH-style set-ups where the discovery file lives on the remote host, a new `nanocoder.serverToken` setting lets the user paste the token manually. Stale discovery files (where the recorded PID is no longer alive) are ignored, so a crashed CLI can no longer hold the port hostage; and a live foreign CLI that has taken over the file is left alone on shutdown, so two concurrent sessions do not clobber each other.
