---
"@nanocollective/nanocoder": patch
---

`read_file` now refuses binary files such as images, archives and compiled output with a clear "binary file" message, instead of returning a block of replacement and control characters to the model. A file is treated as binary when a NUL byte appears in its first 8,000 characters. PDF and DOCX files still convert to text, and `metadata_only` still works on binary files.
