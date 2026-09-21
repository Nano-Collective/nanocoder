---
"@nanocollective/nanocoder": patch
---

Fixed custom command arguments containing `$` being rewritten before they reached the model. `substituteTemplateVariables` passed the value straight to `String.prototype.replace`, which treats a string replacement as a substitution template rather than a literal: `$&` expanded to the `{{arg}}` placeholder it was replacing, `` $` `` and `$'` spliced a whole half of the command template into the middle of the prompt, and `$$` collapsed to a single `$`. Those are ordinary characters in a shell snippet, a regex, a Makefile or a price, so `/mycommand "use $' to quote"` silently sent something other than what was typed, with no way to see it. Values are now inserted through a replacer function, the same way `custom-tools/template.ts` already did. This is the same defect #1057 fixed for `string_replace` and `diff_edit`; the custom-command path was not covered by it.

Also fixed a parameter name containing a regex metacharacter crashing the command. The key was interpolated into the pattern unescaped, so a parameter called `a(b` built `/\{\{\s*a(b\s*\}\}/` and threw `Invalid regular expression: Unterminated group`. Keys are escaped now, which also means a key like `a.b` matches literally instead of matching `axb`.
