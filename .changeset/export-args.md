---
"@nanocollective/nanocoder": patch
---

`/export` reads all its arguments before it writes anything: `--json` works before or after the filename, and an unknown flag or a second filename is an error with the usage, instead of becoming the file name (`/export --josn` wrote a markdown file named `--josn`, `/export my chat.md` overwrote a file named `my`).
