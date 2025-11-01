# AI SDK Simplification Implementation Plan - Revised

## Executive Summary

After analyzing the current codebase, this revised plan addresses the actual architecture and provides targeted improvements. The codebase is already using AI SDK v5 correctly, but has some redundant layers that can be simplified.

**Current State Analysis:**

- ✅ Already using AI SDK v5 with `tool()`, `jsonSchema()`, `generateText()`, `streamText()`
- ✅ Tools are in `.tsx` files (React components for Ink CLI UI)
- ✅ Clean separation: Tools don't auto-execute (human-in-the-loop)
- ❌ MCPToolAdapter is redundant (60 lines of unnecessary code)
- ❌ Multiple registries for the same data (4 registries when 1-2 would suffice)
- ⚠️ Message conversion is necessary (internal format vs AI SDK format)

## Architecture Overview

```
Current Architecture:
┌─────────────────┐
│  AISDKClient    │ ← Uses generateText/streamText with tools
│                 │   Converts Message[] → ModelMessage[]
└────────┬────────┘
         │
┌────────▼────────┐
│  ToolManager    │ ← Manages 4 registries:
│                 │   - toolRegistry (handlers)
│                 │   - toolFormatters (UI)
│                 │   - toolValidators (validation)
│                 │   - nativeToolsRegistry (AI SDK tools)
└────────┬────────┘
         │
┌────────▼────────┐
│ MCPToolAdapter  │ ← REDUNDANT: Creates handlers for MCP tools
│                 │   that just call mcpClient.callTool()
└────────┬────────┘
         │
┌────────▼────────┐
│   MCPClient     │ ← Already creates AI SDK tools via getNativeToolsRegistry()
└─────────────────┘
```

## Implementation Phases (Revised)

### 🟢 Phase 1: Remove MCPToolAdapter (Immediate Win)

**Duration:** 30 minutes  
**Code Reduction:** ~60 lines  
**Risk:** Very Low

The MCPToolAdapter is completely redundant. It:

1. Creates tool handlers that just call `mcpClient.callTool()`
2. Registers these in toolRegistry
3. But MCPClient already provides native AI SDK tools!

#### Implementation Steps:

```typescript
// File: source/tools/tool-manager.ts

// Step 1: Remove import
- import {MCPToolAdapter} from '@/mcp/mcp-tool-adapter';

// Step 2: Remove property
- private mcpAdapter: MCPToolAdapter | null = null;

// Step 3: Update initializeMCP()
async initializeMCP(servers: MCPServer[], onProgress?: (result: MCPInitResult) => void): Promise<MCPInitResult[]> {
  if (servers && servers.length > 0) {
    this.mcpClient = new MCPClient();
    const results = await this.mcpClient.connectToServers(servers, onProgress);

    // REMOVE these lines:
    - this.mcpAdapter = new MCPToolAdapter(this.mcpClient);
    - this.mcpAdapter.registerMCPTools(this.toolRegistry);

    // Keep this - it's already correct:
    const mcpNativeTools = this.mcpClient.getNativeToolsRegistry();
    this.nativeToolsRegistry = {
      ...staticNativeToolsRegistry,
      ...mcpNativeTools,
    };

    // ADD: Register MCP tool handlers directly
    for (const toolName of Object.keys(mcpNativeTools)) {
      this.toolRegistry[toolName] = async (args: any) => {
        return this.mcpClient.callTool(toolName, args);
      };
    }

    return results;
  }
  return [];
}

// Step 4: Update disconnectMCP()
async disconnectMCP(): Promise<void> {
  if (this.mcpClient) {
    // REMOVE: this.mcpAdapter.unregisterMCPTools(this.toolRegistry);

    // ADD: Remove MCP tools from registry
    const mcpTools = this.mcpClient.getNativeToolsRegistry();
    for (const toolName of Object.keys(mcpTools)) {
      delete this.toolRegistry[toolName];
    }

    await this.mcpClient.disconnect();
    this.nativeToolsRegistry = {...staticNativeToolsRegistry};
    this.mcpClient = null;
    - this.mcpAdapter = null;
  }
}
```

```bash
# Step 5: Delete the adapter file
rm source/mcp/mcp-tool-adapter.ts

# Step 6: Test
pnpm test:all
```

### 🟡 Phase 2: Optimize Registry Structure (Optional)

**Duration:** 2 hours  
**Risk:** Medium  
**Decision:** DEFER - Current structure works well for Ink UI

The current 4 registries actually serve different purposes:

- `toolRegistry`: Execution handlers (needed for human-in-the-loop)
- `toolFormatters`: React components for CLI UI (essential for Ink)
- `toolValidators`: Pre-execution validation (improves UX)
- `nativeToolsRegistry`: AI SDK tools for LLM

**Recommendation:** Keep as-is. The separation is clean and each serves a purpose.

### 🟢 Phase 3: Improve MCP Tool Integration

**Duration:** 1 hour  
**Risk:** Low

Add better MCP tool handling without the adapter:

```typescript
// File: source/mcp/mcp-client.ts

// Add a method to get tool entries with handlers
getToolEntries(): Array<{name: string; tool: AISDKCoreTool; handler: ToolHandler}> {
  const entries = [];

  for (const [serverName, serverTools] of this.serverTools.entries()) {
    for (const mcpTool of serverTools) {
      entries.push({
        name: mcpTool.name,
        tool: tool({
          description: mcpTool.description
            ? `[MCP:${serverName}] ${mcpTool.description}`
            : `MCP tool from ${serverName}`,
          inputSchema: jsonSchema(mcpTool.inputSchema || {type: 'object'}),
        }),
        handler: async (args: any) => this.callTool(mcpTool.name, args),
      });
    }
  }

  return entries;
}
```

### 🟡 Phase 4: Clean Up AI SDK Client (Optional)

**Duration:** 1 hour  
**Risk:** Low

The AI SDK client is actually well-structured. Potential improvements:

1. **Keep XML parsing** - It's a good fallback for models without native tool calling
2. **Keep message conversion** - Internal format differs from AI SDK format
3. **Consider removing**: Model info cache (seems unused)

```typescript
// File: source/ai-sdk-client.ts

// Remove if unused:
- private modelInfoCache: Map<string, ModelInfo> = new Map();

// Simplify getContextSize() if model info not needed:
getContextSize(): number {
  return 0; // Or remove method if not used
}
```

## What NOT to Change

Based on the analysis, these should be kept as-is:

### 1. **Tool File Structure (.tsx files)**

The tools are React components for the Ink CLI framework. The `.tsx` extension is correct.

### 2. **Message Conversion**

The `convertToModelMessages()` function is necessary because:

- Internal format uses `role: 'tool'` for tool results
- AI SDK expects different format
- Conversion at boundary is the right pattern

### 3. **Multiple Registries**

While it seems redundant, each registry serves a purpose:

- Handlers for execution
- Formatters for UI
- Validators for pre-checks
- Native tools for AI SDK

### 4. **XML Tool Call Parsing**

This is a smart fallback for models that don't support native tool calling.

## Recommended Action Plan

### Immediate Actions (30 mins)

1. **Remove MCPToolAdapter** (Phase 1)
   - Biggest immediate win
   - Zero risk
   - Removes 60 lines of redundant code

### Future Considerations

2. **Add TypeScript Interface for ToolEntry** (New suggestion)

```typescript
// source/types/core.ts
export interface ToolEntry {
	name: string;
	tool: AISDKCoreTool; // For AI SDK
	handler: ToolHandler; // For execution
	formatter?: ToolFormatter; // For UI (React component)
	validator?: ToolValidator; // For validation
}
```

3. **Consider Tool Registry Helper Class**

```typescript
class ToolRegistry {
	private tools: Map<string, ToolEntry> = new Map();

	register(entry: ToolEntry): void {
		this.tools.set(entry.name, entry);
	}

	getHandler(name: string): ToolHandler | undefined {
		return this.tools.get(name)?.handler;
	}

	getFormatter(name: string): ToolFormatter | undefined {
		return this.tools.get(name)?.formatter;
	}

	getNativeTools(): Record<string, AISDKCoreTool> {
		const native: Record<string, AISDKCoreTool> = {};
		for (const [name, entry] of this.tools) {
			native[name] = entry.tool;
		}
		return native;
	}
}
```

## Testing Strategy

After Phase 1:

```bash
# Unit tests
pnpm test:all

# Manual test - Static tools
npm run dev
# Try: "Read the package.json file"

# Manual test - MCP tools (if configured)
# Try: "List available MCP tools"
```

## Success Metrics

### Phase 1 Success:

- [ ] MCPToolAdapter removed
- [ ] MCP tools still work
- [ ] All tests pass
- [ ] 60 lines of code removed

### Overall Success:

- [ ] Simpler codebase
- [ ] No functionality lost
- [ ] Better code organization

## Summary

The codebase is already well-architected. The main improvement is removing the redundant MCPToolAdapter. Other suggested changes in the original plans would actually make things worse:

- ❌ Don't merge all registries - they serve different purposes
- ❌ Don't remove message conversion - it's necessary
- ❌ Don't change tool file extensions - .tsx is correct for React components
- ✅ DO remove MCPToolAdapter - it's completely redundant
- ✅ DO consider adding TypeScript interfaces for better type safety

**Start with Phase 1 - it's a quick win with zero risk.**

## Detailed Implementation Guide for AI Agents

### Phase 1: Remove MCPToolAdapter - Step by Step

#### Step 1: Backup Current State

```bash
git add -A
git commit -m "chore: backup before removing MCPToolAdapter"
```

#### Step 2: Modify tool-manager.ts

```bash
# Open source/tools/tool-manager.ts
```

Make these exact changes:

1. **Line 16**: Remove the import

```typescript
// DELETE THIS LINE:
import {MCPToolAdapter} from '@/mcp/mcp-tool-adapter';
```

2. **Line 40**: Remove the property

```typescript
// DELETE THIS LINE:
private mcpAdapter: MCPToolAdapter | null = null;
```

3. **Lines 54-80**: Update initializeMCP method

```typescript
async initializeMCP(
  servers: MCPServer[],
  onProgress?: (result: MCPInitResult) => void,
): Promise<MCPInitResult[]> {
  if (servers && servers.length > 0) {
    this.mcpClient = new MCPClient();
    const results = await this.mcpClient.connectToServers(
      servers,
      onProgress,
    );

    // Get MCP native tools
    const mcpNativeTools = this.mcpClient.getNativeToolsRegistry();

    // Merge with static tools
    this.nativeToolsRegistry = {
      ...staticNativeToolsRegistry,
      ...mcpNativeTools,
    };

    // Register MCP tool handlers directly (no adapter needed)
    for (const toolName of Object.keys(mcpNativeTools)) {
      this.toolRegistry[toolName] = async (args: any) => {
        if (!this.mcpClient) {
          throw new Error('MCP client not initialized');
        }
        return this.mcpClient.callTool(toolName, args);
      };
    }

    return results;
  }
  return [];
}
```

4. **Lines 156-169**: Update disconnectMCP method

```typescript
async disconnectMCP(): Promise<void> {
  if (this.mcpClient) {
    // Remove MCP tools from registry
    const mcpTools = this.mcpClient.getNativeToolsRegistry();
    for (const toolName of Object.keys(mcpTools)) {
      delete this.toolRegistry[toolName];
    }

    // Disconnect from servers
    await this.mcpClient.disconnect();

    // Reset to static tools only
    this.nativeToolsRegistry = {...staticNativeToolsRegistry};
    this.mcpClient = null;
  }
}
```

#### Step 3: Delete MCPToolAdapter file

```bash
rm source/mcp/mcp-tool-adapter.ts
```

#### Step 4: Run Tests

```bash
pnpm test:all
```

#### Step 5: Verify Functionality

```bash
npm run dev
```

Test commands:

- "Read the package.json file" (tests static tools)
- "Create a test file" (tests file creation)
- If MCP configured: "List available tools" (tests MCP integration)

#### Step 6: Commit Changes

```bash
git add -A
git commit -m "refactor: remove redundant MCPToolAdapter

- MCPToolAdapter was creating unnecessary intermediate handlers
- MCP tools are now registered directly in ToolManager
- Reduces code by ~60 lines with no functionality loss
- MCP tools still work through mcpClient.callTool()"
```

### Phase 3: Add ToolEntry Interface (Optional Enhancement)

#### Step 1: Update types/core.ts

Add after line 105:

```typescript
// Tool formatter type for Ink UI
export type ToolFormatter = (
	args: any,
	result?: string,
) =>
	| string
	| Promise<string>
	| React.ReactElement
	| Promise<React.ReactElement>;

// Tool validator type
export type ToolValidator = (
	args: any,
) => Promise<{valid: true} | {valid: false; error: string}>;

// Unified tool entry interface (future improvement)
export interface ToolEntry {
	name: string;
	tool: AISDKCoreTool; // For AI SDK
	handler: ToolHandler; // For execution
	formatter?: ToolFormatter; // For UI (React component)
	validator?: ToolValidator; // For validation
}
```

### Common Issues and Solutions

#### Issue 1: TypeScript Errors

If you see TypeScript errors after removing MCPToolAdapter:

```bash
# Clear TypeScript cache
rm -rf node_modules/.cache
pnpm tsc --noEmit
```

#### Issue 2: Test Failures

If tests fail:

```bash
# Run specific test
pnpm test source/tools/tool-manager.spec.ts

# Check for import errors
grep -r "MCPToolAdapter" source/
```

#### Issue 3: MCP Tools Not Working

Verify MCP client is working:

```typescript
// Add debug logging in initializeMCP
console.log('MCP tools registered:', Object.keys(mcpNativeTools));
console.log('Tool registry keys:', Object.keys(this.toolRegistry));
```

### Verification Checklist

After completing Phase 1:

- [ ] `source/mcp/mcp-tool-adapter.ts` is deleted
- [ ] No imports of MCPToolAdapter remain
- [ ] `pnpm test:all` passes
- [ ] `pnpm build` succeeds
- [ ] Static tools work in dev mode
- [ ] MCP tools work if configured
- [ ] No TypeScript errors

### Next Steps

After successful Phase 1:

1. **Monitor for issues** - Run the app for a few minutes
2. **Check performance** - MCP tools should be slightly faster without the adapter
3. **Consider Phase 3** - Add ToolEntry interface for better type safety
4. **Document changes** - Update CLAUDE.md if needed

## Why This Plan is Better

1. **Focused on Real Issues**: Removes actual redundancy (MCPToolAdapter)
2. **Preserves Working Code**: Keeps the 4 registries that serve different purposes
3. **Respects Architecture**: Understands that .tsx files are for React/Ink components
4. **Low Risk**: Phase 1 is a simple deletion with clear rollback
5. **Immediate Value**: 60 lines of code removed in 30 minutes

This revised plan is based on actual code analysis rather than assumptions, making it more reliable for AI agents to execute.
