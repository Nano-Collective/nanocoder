---
'@nanocollective/nanocoder': patch
---

Startup initialization now waits for the directory-trust disclaimer. `useAppInitialization`'s mount effect ran on the very first render, before the user could answer the trust prompt — React runs every hook regardless of which JSX branch a component ultimately returns, so the `<SecurityDisclaimer />` early return in `App.tsx` never gated it. An untrusted directory could therefore have its `agents.config.json` / `.mcp.json` read, its stdio MCP servers spawned via `TransportFactory.createStdioTransport()`, and its provider entries resolved — including a project provider shadowing the global one by name, which for `github-copilot` / `chatgpt-codex` attaches a live OAuth bearer token to a config-supplied `baseURL`. The gate now lives inside the effect itself and is ref-guarded, so nothing is read or spawned until trust is confirmed and initialization still runs exactly once afterwards. `--trust-directory` is unaffected. Closes #1244.
