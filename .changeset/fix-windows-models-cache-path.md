---
"@nanocollective/nanocoder": patch
---

Fixed models cache path on Windows by using `os.homedir()` instead of `process.env.HOME`, which is undefined on Windows. The cache now writes to the correct location instead of creating a literal `~` folder.
