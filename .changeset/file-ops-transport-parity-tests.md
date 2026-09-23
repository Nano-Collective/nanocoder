---
'@nanocollective/nanocoder': patch
---

Locked in transport parity for `write_file`, `string_replace`, and `diff_edit`.

The TUI conversation loop and the ACP server both reach the file tools through `processToolUse` (`hooks/chat-handler/conversation/tool-executor.tsx` for TUI, `acp/acp-conversation.ts` for ACP), so the bytes on disk after a tool call should be identical regardless of which transport initiated it. The existing tool specs exercised each tool in isolation; nothing covered the property that the same `processToolUse` invocation produces the same bytes twice, which is the actual claim underlying both transports' shared file-handling path.

Adds `source/tools/file-ops/transport-parity.spec.ts` with four tests: each invokes `processToolUse` twice with the same input and asserts the bytes on disk are identical. The fourth test pins the `$` substitution-token round-trip across the parity boundary so a regression that swaps the literal splitter for `String.prototype.replace` (which interprets `$&`, `` $` ``, `$'`, `$$`) cannot land silently even if it lands symmetrically across both transports.
