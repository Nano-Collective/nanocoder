---
"@nanocollective/nanocoder": patch
---

Fix `find_files` and `search_file_contents` searching the project root instead of the current directory after a `cd` into a subdirectory, when the project was opened through a symlinked path. Bash reports the physical directory after a `cd`, and comparing it with the symlinked project root by spelling treated it as outside the project.
