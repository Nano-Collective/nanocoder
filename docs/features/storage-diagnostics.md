---
title: "Storage Diagnostics"
description: "Inspect local storage without changing files or starting a model"
---

# Storage diagnostics

Run `nanocoder storage` in a terminal to inspect Nanocoder-wide sessions and
artifacts alongside the current project's timeline and checkpoints. This opens
a dedicated, read-only view without starting a chat session, loading a model,
or asking you to trust the directory. The overview labels each section's
**global** or **project** scope, count, size, and findings, and shows the
selected section's root path. Select a
section with Up/Down and Enter, then select an item or finding to see its
details and path. Esc goes back; `q` or Ctrl+C exits. Limits are shown where
available. A "potential orphan" warning does not prove a session is inactive.

For scripts or terminals without an interactive TTY, use:

```sh
nanocoder storage --format json | jq .sections
```

This prints one JSON document to stdout and exits. Errors go to stderr with a
nonzero exit status. Neither mode deletes, cleans, or repairs data. To see the
available syntax, run `nanocoder storage --help`.
