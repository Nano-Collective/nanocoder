---
"@nanocollective/nanocoder": patch
---

Allow projects located at a filesystem root, including `/` and Windows drive roots, to pass path-containment checks. File tools and `search_file_contents` no longer reject every path with `escapes project directory` when the workspace is mounted at the root, as it is in many containers. Closes #1240.
