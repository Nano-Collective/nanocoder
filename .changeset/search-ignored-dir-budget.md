---
'@nanocollective/nanocoder': patch
---

Fixed `search_file_contents` returning 0 matches when a gitignored directory sits under the search path. The old code let ripgrep kill itself at the raw-match budget; when the first directory on the walk was gitignored but dense with matches, every kill-slot went to matches the JS-side filter would drop, so the search came back empty even though real files were right there. The ripgrep call now streams JSON through a kept-match counter that ignores gitignored lines before spending the budget, and the project's own ignore rules are also handed to rg as a temp `--ignore-file` so rg prunes ignored paths during traversal. Closes #1341.
