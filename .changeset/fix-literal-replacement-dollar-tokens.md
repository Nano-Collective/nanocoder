---
"@nanocollective/nanocoder": patch
---

Fixed `string_replace` and `diff_edit` corrupting edits whose replacement text contains `$`. Both tools passed the model's replacement straight to `String.prototype.replace`, which treats that argument as a substitution template rather than a literal: `$$` collapsed to a single `$`, `$&` expanded to the matched text, and ``$` ``/`$'` spliced a whole half of the file into the middle of the edit. Those are ordinary characters in shell scripts, Makefiles, CI YAML and anything that builds a regex, so the bytes on disk silently diverged from the diff the user approved. Replacements are now spliced by index, so the approved preview - in the terminal and over ACP - is what lands. Closes #1057.
