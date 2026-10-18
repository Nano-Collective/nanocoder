---
'@nanocollective/nanocoder': patch
---

Fixed LSP file paths and URIs in both directions. `lsp_get_diagnostics` converted URIs from the language server by stripping `file://`, so Windows drive (`file:///C:/src/app.ts` → `/C:/src/app.ts`), UNC and percent-encoded paths (spaces, non-ASCII) came out wrong; they are now converted with `fileURLToPath`. The LSP manager also built URIs by string concatenation, sending unencoded or relative URIs to the server, so diagnostics for files with spaces, non-ASCII, `#` or `%` in their path, or passed as relative paths, were never found; URIs are now built with `pathToFileURL`. Closes #1516.
