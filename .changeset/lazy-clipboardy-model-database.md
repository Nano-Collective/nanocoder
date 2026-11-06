---
"@nanocollective/nanocoder": patch
---

Fixed startup pulling `clipboardy` (and its `execa`/`semver` chain) into the boot graph just for the model database copy button. The clipboard module now loads on first copy. Closes #1775.
