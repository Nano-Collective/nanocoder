---
"@nanocollective/nanocoder": patch
---

Clamp `find_files` and `search_file_contents` result limits to whole numbers between 1 and the maximum, falling back to the default for invalid values, so an invalid limit no longer reports that nothing was found. Closes #2449.
