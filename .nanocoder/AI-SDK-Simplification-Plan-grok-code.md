# AI SDK Integration Simplification Plan

## Overview

The current AI-SDK integration is mostly aligned with AI SDK v5 patterns but has unnecessary complexity in MCP tool management. This plan removes redundant layers and merges duplicate registries while maintaining existing functionality. **KISS principle**: Direct MCP → AISDK tools, single registry.

## Current State ✅/❌

**Good (Already AI SDK v5 aligned):**

- Uses `tool()`, `jsonSchema()`, `generateText()`, `streamText()`
- AISDKClient passes tools directly
- MCP tools converted to AISDKCoreTool
- Tool execution via ToolManager

**Problems to Fix:**

- ❌ MCPToolAdapter: Unnecessary MCPTool → NanocoderTool → AISDKCoreTool conversion
- ❌ Duplicate Registries: toolRegistry vs nativeToolsRegistry with same data

## React/Ink UI Context (Important!)

This project uses **Ink CLI app architecture**:

- **Tool Formatters**: Return `React.ReactElement` or JSX for rich terminal display (see: components/tool-\*.tsx)
- **Tool Validators**: Validate inputs in terminal UI flow
- **Preserve these**: Essential for CLI user experience, not "unused code"

```
┌────────────────┐
│   AISDKClient  │  ← Takes Record<string, AISDKCoreTool>
│                │
│ generateText({ │
│   tools: {},    │
│   ...           │
│ })             │
└────────────────┘
        ▲
        │
┌────────────────┐
│  ToolManager   │  ← Single registry for all tools
│                │     Static + MCP in AISDK format
└────────────────┘
        ▲
        │
┌────────────────┐
│ MCPToolManager │  ← Direct MCP → AISDK tools (renamed)
│ (was MCPClient)│     No adapter layer
└────────────────┘
```

## Key Changes Summary

1. **Remove MCPToolAdapter** 🗑️: Direct MCPClient.getNativeToolsRegistry() → AISDKCoreTool
2. **Merge Registries** 📋: Single `allTools` registry instead of duplicates
3. **Rename Clarity** ✏️: MCPClient → MCPToolManager (only manages tools)

## Implementation Phases (Agent Workflow)

### Phase 1: Remove MCPToolAdapter (Low Risk ✅)

**Goal:** Eliminate unnecessary conversion layer.

**Agent Steps:**

1. **Analyze:** Look at `source/mcp/mcp-tool-adapter.ts` - it's ~50 lines converting formats.
2. **Edit** `source/tools/tool-manager.ts`:
   - Remove `import {MCPToolAdapter}`
   - Remove `private mcpAdapter: MCPToolAdapter | null`
   - Update `initializeMCP()`:
     ```typescript
     // REMOVE: this.mcpAdapter = new MCPToolAdapter(this.mcpClient);
     // REMOVE: this.mcpAdapter.registerMCPTools(this.toolRegistry);
     ```
3. **Delete** `source/mcp/mcp-tool-adapter.ts` file
4. **Verify:** MCP tools still load from `this.mcpClient.getNativeToolsRegistry()`

**Testing:**

- [ ] Can connect to MCP servers
- [ ] MCP tools appear in `getAllTools()`

### Phase 2: Merge Tool Registries (Medium Risk ⚠️)

**Goal:** Single source of truth for tools.

**Agent Steps:**

1. **Refactor** `source/tools/tool-manager.ts`:

   - Replace separate registries with single `allTools: Record<string, AISDKCoreTool>`
   - Update constructor:

     ```typescript
     private allTools: Record<string, AISDKCoreTool> = {};

     constructor() {
       this.allTools = {...staticNativeToolsRegistry};
     }
     ```

   - Update `initializeMCP()`:
     ```typescript
     // REPLACEMENT for nativeToolsRegistry/trialRegistry merging:
     const mcpTools = this.mcpClient.getNativeToolsRegistry();
     this.allTools = {...this.allTools, ...mcpTools};
     ```
   - Rename method: `getAllTools()` returns `this.allTools`
   - **Deprecated:** Remove `getToolRegistry()`, `getNativeToolsRegistry()`

2. **Handle MCP Execution:** Keep tool handlers Map for non-AISDK execution (MCP callTool)

   ```typescript
   private toolHandlers: Map<string, ToolHandler> = new Map();

   // In initializeMCP - add handlers for MCP tools:
   for (const toolName of Object.keys(mcpTools)) {
     this.toolHandlers.set(toolName, async (args) => this.mcpClient.callTool(toolName, args));
   }
   ```

**Testing:**

- [ ] Static + MCP tools in single registry
- [ ] LLM can use all tools
- [ ] MCP tool execution still works

### Phase 3: Rename and Cleanup (Low Risk ✅)

**Goal:** Better naming and remove dead code.

**Agent Steps:**

1. **Rename Class:** `source/mcp/mcp-client.ts` → Rename `export class MCPClient` to `export class MCPToolManager`
2. **Update Imports:** Search codebase for `import {MCPClient}` and change to `MCPToolManager`
3. **Remove Unused:** In `tool-manager.ts`
   - Remove `toolFormatters`, `toolValidators`
   - Remove `getToolFormatter()`, `getToolValidator()`
4. **Build Check:** Run `npm run build` to ensure no type errors

**Testing:**

- [ ] All imports updated
- [ ] Build passes
- [ ] MCP connection still works

## Benefits Summary

- **Code Reduction:** ~100 lines removed (adapter + duplicate methods)
- **Simpler Flow:** MCP tools directly available in AISDK format
- **Single Registry:** No confusion between toolRegistry/nativeToolsRegistry
- **Cleaner API:** ToolManager has fewer, clearer methods
- **Better Docs:** MCPToolManager clarifies limited scope vs. full MCP client

## Rollback Plan

**Per Phase:** Each phase is independent for easy revert.

- Phase 1: Restore adapter file from git
- Phase 2: Revert registry changes, restore getters
- Phase 3: Rename back if confusion

## Files To Change

| File                             | Phase | Action                                          |
| -------------------------------- | ----- | ----------------------------------------------- |
| `source/mcp/mcp-tool-adapter.ts` | 1     | **DELETE**                                      |
| `source/tools/tool-manager.ts`   | 1-2   | Remove adapter, merge registries, remove unused |
| `source/mcp/mcp-client.ts`       | 3     | Rename class MCPClient → MCPToolManager         |
| All imports of MCPClient         | 3     | Update to MCPToolManager                        |

## For New Contributors

After this simplification:

1. **Adding Tools:** AISDK tools go in `/tools/index.ts` in native format
2. **MCP Tools:** Call `MCPToolManager.connectToServers()` → `getNativeToolsRegistry()`
3. **LLM Usage:** `ToolManager.getAllTools()` → pass directly to `generateText({tools: ...})`
4. **Execution:** MCP tools auto-executed via `callTool()`, static tools via their own handlers

The system is now: **Direct, single registry, no conversions**! 🎯

---

_This plan maintains AI SDK v5 patterns while making the codebase dramatically simpler for agents and humans alike. Follow phases incrementally, testing after each._
