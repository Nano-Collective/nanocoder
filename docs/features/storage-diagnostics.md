---
title: "Storage Diagnostics"
description: "Inspect local storage without changing files or starting a model"
---

# Storage diagnostics

Run `nanocoder storage` in a terminal to inspect Nanocoder-wide sessions and
artifacts alongside the current project's timeline and checkpoints. This opens
a dedicated, read-only dashboard without starting a chat session, loading a
model, or asking you to trust the directory. The store list shows sizes and
finding counts; the selected store shows its **global** or **project** scope,
root path, limits, entries, and findings. On narrow terminals the panes stack.
Use Up/Down to select a store, Enter to explore its entries, then Enter again
for an item or finding's details and path. Esc goes back (or exits from the
store list); `q` or Ctrl+C exits at any time. A "potential orphan" warning does
not prove a session is inactive.

For scripts or terminals without an interactive TTY, use:

```sh
nanocoder storage --format json | jq .sections
```

This prints one JSON document to stdout and exits. Errors go to stderr with a
nonzero exit status. Neither mode deletes, cleans, or repairs data. To see the
available syntax, run `nanocoder storage --help`.
