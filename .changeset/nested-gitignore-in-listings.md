---
"@nanocollective/nanocoder": patch
---

`list_directory` and the `/explorer` file tree now respect a `.gitignore` inside a subdirectory, the way git, `find_files` and `search_file_contents` already do. Files a package ignores for itself, such as `generated/` or `.turbo/` in a monorepo, are no longer listed to the model or shown in the explorer. Thanks to @inahus99. Closes #2353.
