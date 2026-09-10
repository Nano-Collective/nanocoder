---
"@nanocollective/nanocoder": patch
---

Fixed `ToolManager.disconnectMCP()` rebuilding the whole tool registry from the built-in exports and clearing the custom tool map. The `unregisterMany()` call above it already removes exactly the MCP tools, so the rebuild was redundant, and it discarded three other things with them: workspace custom tools along with the `approval` and `read_only` metadata that plan and headless filtering read, skill and bundle tools registered through `registerSkillTool()`, and the constructor's removal of `web_search` when no Brave Search key is configured, which came back as an unusable tool. The only caller today is the shutdown handler registered in `initializeMCP`, where discarding state is harmless, so nothing user-facing changes. The method is public and any other caller would have hit all four. Closes #1034.
