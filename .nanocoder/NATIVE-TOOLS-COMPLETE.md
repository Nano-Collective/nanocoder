# Native AI SDK Tools Migration - COMPLETE ✅

**Date:** 2025-10-31

## Summary

Successfully migrated Nanocoder to use AI SDK native tools everywhere, eliminating the need for tool format conversion. All tools (static and MCP) now use AI SDK's native `Tool<>` format directly.

## What Changed

### 1. ✅ Removed Tool Conversion Layer

**Before:**

```typescript
// Had to convert Tool[] to AI SDK format
function convertToolsToAISDK(
	tools: Tool[],
): Record<string, AISDKTool> | undefined {
	// ... complex conversion logic
}
```

**After:**

```typescript
// Tools are already in AI SDK format - pass directly
const aiTools = Object.keys(tools).length > 0 ? tools : undefined;
```

### 2. ✅ Updated Tool Definitions

**Before:**

```typescript
export const readFileTool: ToolDefinition = {
  tool: readFileCoreTool,
  handler: executeReadFile,
  config: {  // Legacy OpenAI format
    type: 'function',
    function: {
      name: 'read_file',
      description: '...',
      parameters: { ... }
    }
  }
};
```

**After:**

```typescript
export const readFileTool: ToolDefinition = {
	name: 'read_file', // Simple metadata
	tool: readFileCoreTool, // AI SDK native tool
	handler: executeReadFile,
	formatter,
	validator,
};
```

### 3. ✅ Simplified LLMClient Interface

**Before:**

```typescript
interface LLMClient {
	chat(
		messages: Message[],
		tools: Tool[],
		signal?: AbortSignal,
	): Promise<LLMChatResponse>;
}
```

**After:**

```typescript
interface LLMClient {
	chat(
		messages: Message[],
		tools: Record<string, AISDKCoreTool>,
		signal?: AbortSignal,
	): Promise<LLMChatResponse>;
}
```

### 4. ✅ Updated MCP Tool Conversion

MCP tools are now converted to AI SDK's native format when loaded:

```typescript
const coreTool = tool({
	description: `[MCP:${serverName}] ${mcpTool.description}`,
	inputSchema: jsonSchema(mcpTool.inputSchema || {type: 'object'}),
	// No execute function - human-in-the-loop pattern
});
```

### 5. ✅ Streamlined Tool Manager

```typescript
class ToolManager {
	getAllTools(): Record<string, AISDKCoreTool> {
		return this.nativeToolsRegistry; // Already in AI SDK format
	}
}
```

## Key Architectural Changes

### Tool Definition Structure

```typescript
export interface ToolDefinition {
  name: string;           // Metadata for lookup
  tool: AISDKCoreTool;    // Native AI SDK tool
  handler: ToolHandler;   // Manual execution (human-in-the-loop)
  formatter?: ...;        // UI formatting
  validator?: ...;        // Pre-execution validation
}
```

**Why keep `name` as metadata?**
AI SDK's `Tool<>` type is opaque - it doesn't expose `name`, `description`, or `parameters` directly. We keep minimal metadata (`name`) for registry lookups and tool identification.

### Conversion Flow

**Old Flow:**

1. Define tools with both `tool` (AI SDK) and `config` (OpenAI format)
2. Pass `config` array to ToolManager
3. Convert to AI SDK format in `convertToolsToAISDK()`
4. Pass to AI SDK

**New Flow:**

1. Define tools with `name` metadata and `tool` (AI SDK native)
2. Build registry: `Record<string, AISDKCoreTool>`
3. Pass directly to AI SDK - **no conversion needed!**

## Files Modified

### Core Changes

- `source/types/core.ts` - Updated ToolDefinition, added `name` field, removed `config`
- `source/ai-sdk-client.ts` - Removed conversion, accept `Record<string, AISDKCoreTool>` directly
- `source/tools/index.ts` - Use `def.name` instead of `def.config.function.name`
- `source/tools/tool-manager.ts` - Return native tools directly
- `source/hooks/useChatHandler.tsx` - Pass tools as object not array
- `source/mcp/mcp-client.ts` - Convert MCP tools to AI SDK format
- `source/utils/prompt-processor.ts` - Accept native tools (simplified documentation)

### Tool Definitions (All 10 tools)

- `source/tools/read-file.tsx` - Added `name`, removed `config`
- `source/tools/create-file.tsx` - Added `name`, removed `config`
- `source/tools/insert-lines.tsx` - Added `name`, removed `config`
- `source/tools/replace-lines.tsx` - Added `name`, removed `config`
- `source/tools/delete-lines.tsx` - Added `name`, removed `config`
- `source/tools/read-many-files.tsx` - Added `name`, removed `config`
- `source/tools/execute-bash.tsx` - Added `name`, removed `config`
- `source/tools/web-search.tsx` - Added `name`, removed `config`
- `source/tools/fetch-url.tsx` - Added `name`, removed `config`
- `source/tools/search-files.tsx` - Added `name`, removed `config`

### Test Updates

- `source/tools/fetch-url.spec.tsx` - Updated to use `name` instead of `config`
- `source/tools/search-files.spec.tsx` - Updated to use `name` instead of `config`

## Benefits

### 1. No Conversion Overhead

- **Before:** ~40 lines of conversion code
- **After:** Direct pass-through, 1 line

### 2. Single Source of Truth

- Tools defined once in AI SDK format
- No dual formats to maintain (AI SDK + OpenAI)

### 3. Type Safety

- Using AI SDK's actual `Tool<>` type
- No manual schema conversions

### 4. Simpler Architecture

- Removed `convertToolsToAISDK()` helper
- Removed legacy `config` property
- Cleaner interfaces

### 5. Future-Proof

- Direct AI SDK usage means we get updates automatically
- Less maintenance burden

## Test Results

✅ **All tests passing:**

- Format: ✅ Pass
- Types: ✅ Pass
- Lint: ✅ Pass (2 warnings for justified `any` usage)
- Tests: ✅ 272 tests pass (4 removed, as they tested legacy `config` structure)
- Knip: ⚠️ 10 warnings (`*CoreTool` exports - false positive, used via tool definitions)

## Trade-offs

### What We Lost

- **Tool documentation in prompts**: AI SDK's `Tool<>` type doesn't expose `description` or `parameters`, so we can't auto-generate detailed tool docs for the system prompt. The model learns tool usage from function calling instead.

### What We Gained

- **Simpler architecture**: No conversion layer
- **Better performance**: Direct pass-through
- **Less code**: ~60 lines removed total
- **Type safety**: Using AI SDK's actual types

## Migration Notes

### For Future Tool Additions

When adding new tools, use this pattern:

```typescript
// 1. Define the AI SDK native tool
export const myToolCoreTool = tool({
	description: 'My tool description',
	inputSchema: jsonSchema<{param: string}>({
		type: 'object',
		properties: {
			param: {type: 'string', description: 'Parameter description'},
		},
		required: ['param'],
	}),
	// NO execute function - human-in-the-loop!
});

// 2. Define the handler
async function executeMyTool(args: {param: string}): Promise<string> {
	// Implementation
}

// 3. Export as ToolDefinition
export const myTool: ToolDefinition = {
	name: 'my_tool', // Metadata for registry
	tool: myToolCoreTool, // Native AI SDK tool
	handler: executeMyTool,
	// Optional: formatter, validator
};
```

### For MCP Tools

MCP tools are automatically converted to AI SDK format in `MCPClient.getNativeToolsRegistry()`:

```typescript
const coreTool = tool({
	description: `[MCP:${serverName}] ${mcpTool.description}`,
	inputSchema: jsonSchema(mcpTool.inputSchema || {type: 'object'}),
});
```

## Conclusion

This migration successfully eliminates the tool conversion layer and uses AI SDK's native tools everywhere. The codebase is now:

1. **Simpler** - Direct AI SDK usage, no conversion
2. **Faster** - No overhead
3. **Type-safe** - Using actual AI SDK types
4. **Maintainable** - Single source of truth
5. **Future-proof** - Direct AI SDK integration

The architecture now correctly follows the principle: **"Why convert tools when we can use AI SDK native tools everywhere?"**

✅ **Migration Complete!**
