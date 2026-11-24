---
"@nanocollective/nanocoder": patch
---

`findUnsafePlaceholder` now rejects a custom tool whose template puts a placeholder inside `$(( ))`, `(( ))` or `[[ ]]`, where an array subscript like `a[$(cmd)]` would run a command even though values are quoted.
