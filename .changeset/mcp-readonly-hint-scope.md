---
"@nanocollective/nanocoder": patch
---

Confined the MCP `readOnlyHint` annotation to plan-mode availability, and made `"enabled": false` actually disable an MCP server. The `readOnlyHint` a server reports was being copied onto its registered tool entries, where `ToolManager.isReadOnly()` also decides whether ACP captures a checkpoint before the call and whether the tool joins a parallel execution batch — so a server annotating itself read-only could talk its way out of a restore point. The hint now lives on the MCP tool mapping, which only plan-mode filtering reads, exactly as the documentation describes. Separately, `enabled` was loaded from config and then ignored: every configured server connected regardless, including in headless runs where MCP tools execute unattended and `"enabled": false` is the only documented opt-out. Disabled servers are now skipped before any connection is attempted.
