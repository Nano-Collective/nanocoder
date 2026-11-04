---
"@nanocollective/nanocoder": patch
---

`lsp_get_diagnostics` no longer reports a broken file as clean. The first call after opening a file asked before the language server had checked it, and a relative path was turned into a malformed `file://` URI that never matched the diagnostics the server published, so both returned "No diagnostics found". Relative paths now resolve against the session directory, a newly opened file waits briefly for the server's first result, and an unchanged file is not re-sent. When a language server fails to start, the diagnostics error now includes its reason (for example typescript-language-server's "Could not find a valid TypeScript installation") instead of only saying no server is available.
