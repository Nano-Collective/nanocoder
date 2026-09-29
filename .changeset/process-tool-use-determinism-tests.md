---
---

Tests only — locks in determinism of `processToolUse` for the file tools (`write_file`, `string_replace`, `diff_edit`), including the `$` substitution-token round-trip. Two `processToolUse` invocations with the same input must produce identical bytes on disk, surviving the validator, argument parser, pre-tool-use gate, and post-tool-use wrapper. Guards against a regression that swaps `replaceFirstLiteral` for `String.prototype.replace` (which interprets `$&`, `` $` ``, `$'`, `$$`).
