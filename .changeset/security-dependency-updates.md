---
"@nanocollective/nanocoder": patch
---

Update dependencies to fix published security advisories. `@modelcontextprotocol/sdk` moves to 1.32 (which also brings patched `express`, `body-parser` and `proxy-addr`), `undici` to 8.12, and `fast-uri` and `zod` to their patched releases. Development and build tooling (`ava`, the changesets CLI and the VS Code extension packager) also pick up patched `brace-expansion`, `js-yaml`, `shell-quote`, `launch-editor`, `markdown-it`, `linkify-it`, `form-data` and `source-map-js`. One high advisory remains in `@azure/msal-node`, used only by `vsce` to package the VS Code extension and not shipped to users; fixing it needs a major upgrade of the packaging tool.
