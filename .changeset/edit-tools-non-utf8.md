---
'@nanocollective/nanocoder': patch
---

Fixed `string_replace` and `diff_edit` damaging files that aren't valid UTF-8, such as Latin-1, Windows-1252 or Shift-JIS files. Both tools decode the whole file as UTF-8 and write the whole file back, so every byte that didn't decode was rewritten as U+FFFD, including on lines the edit never touched, and the edit still reported success. They now refuse these files with an error that explains why, the same way they already refuse PDF and DOCX files, and leave the file unchanged. UTF-8 files, including ones with non-ASCII text or a BOM, edit as before. Thanks to @diyaavirmani. Closes #1854.
