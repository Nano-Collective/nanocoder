---
"@nanocollective/nanocoder": patch
---

Fixed command injection through custom tool placeholders the author had wrapped in quotes. Inside `"{{ q }}"` the added single quotes were literal, so `$(...)` in a model-supplied value ran; inside `'{{ q }}'` the value ended up unquoted. A placeholder in a `#` comment or a here-document let a newline in the value start a new command. A custom tool whose body puts a placeholder inside quotes, `${...}`, a comment or a here-document, or right after `$` or a backslash, is now rejected when it loads, with an error naming the placeholder and the fix (use it bare, or assign it to a variable first). Placeholders are now filled only from declared parameters, so a value the model sends for an undeclared name always renders empty. The `/tools create` design prompt no longer tells the model that `echo "{{ name }}"` is safe.
