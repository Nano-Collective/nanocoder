# AI SDK Native Types Migration Proposal

**Status:** ✅ **PHASES 1, 2, 4 COMPLETE** | ⚠️ **PHASE 3 PARTIAL** | ⏸️ **PHASES 5-6 PENDING**

**Last Updated:** 2025-10-31

## Executive Summary

This proposal outlines a plan to migrate Nanocoder from custom type definitions and conversion layers to AI SDK's native types and utilities. The migration will reduce code complexity, improve type safety, leverage AI SDK's built-in MCP support, and align with industry standards.

**Current Status:** Successfully completed core migration (Phases 1, 2, 4). Eliminated ~220 lines of conversion code. All tools now use AI SDK v5 native format. Phase 3 (proper tool message format) remains for future work.

## Current Architecture

### Pain Points

1. **Manual Type Conversions** (`source/ai-sdk-client.ts`)

   - ~~`convertMessagesToAISDK()`: Converts custom `Message[]` to AI SDK format~~ ✅ REMOVED
   - ~~`jsonSchemaToZod()`: ~80 lines of JSON Schema → Zod conversion~~ ✅ REMOVED
   - ~~`convertToAISDKTools()`: Tool format conversion~~ ✅ REMOVED
   - Tool results converted to user messages (workaround for complexity) ⚠️ STILL PRESENT

2. **Custom Type Definitions** (`source/types/core.ts`)

   - ~~Custom `Message`, `Tool`, `ToolCall`, `ToolResult` interfaces~~ ✅ NOW USE AI SDK TYPES
   - Custom `LLMClient` interface that abstracts AI SDK (kept for abstraction)
   - ~~Not leveraging AI SDK's built-in type inference~~ ✅ NOW USING TYPE INFERENCE

3. **Custom MCP Integration** (`source/mcp/`)

   - Custom `MCPClient` implementation (kept, but returns AI SDK format) ✅ IMPROVED
   - ~~Custom `MCPToolAdapter` to convert MCP tools~~ ✅ REMOVED
   - Not using AI SDK's `experimental_createMCPClient()` ⏸️ FUTURE WORK

4. **Tool Definition Complexity**
   - ~~Tools defined with JSON Schema in custom format~~ ✅ NOW USE `jsonSchema()`
   - ~~Separate handler functions not integrated with tool definitions~~ ✅ INTEGRATED
   - ~~Missing AI SDK's automatic type inference~~ ✅ NOW HAVE TYPE INFERENCE

### What Works Well

1. **Tool Confirmation System** - Custom UI for approving tool execution ✅
2. **Tool Formatters** - React components for displaying tool calls ✅
3. **Tool Validators** - Pre-execution validation logic ✅
4. **Development Modes** - normal/auto-accept/plan modes ✅
5. **Provider Abstraction** - Multi-provider support ✅

## Actual Implementation (AI SDK v5)

### Critical Discovery: Human-in-the-Loop Pattern

**AI SDK's `Tool<>` type is opaque** - it doesn't expose `name`, `description`, or `parameters` properties. This means:

1. We can't extract tool metadata for documentation
2. We must keep minimal metadata (`name`) in `ToolDefinition`
3. Tools are defined **WITHOUT** `execute` functions to maintain human-in-the-loop approval

### 1. Adopted AI SDK v5 Types

**Implementation:**

```typescript
// source/types/core.ts
import {tool, jsonSchema, type Tool as AISDKTool} from 'ai';

// Renamed import to avoid conflict with legacy Tool interface
export type AISDKCoreTool = AISDKTool<any, any>;

export interface ToolDefinition {
	name: string; // Metadata for lookup (AI SDK Tool is opaque)
	tool: AISDKCoreTool; // Native AI SDK tool
	handler: ToolHandler; // Manual execution (human-in-the-loop)
	formatter?: ToolFormatter;
	validator?: ToolValidator;
	requiresConfirmation?: boolean;
}
```

**Key Difference from Proposal:**

- Proposal suggested `coreTool` property, we use `tool`
- Added `name` metadata (not in proposal) because `Tool<>` is opaque
- NO `execute` function in tools (human-in-the-loop pattern)

### 2. Tool Definitions Using AI SDK v5

**Implementation:**

```typescript
// source/tools/read-file.tsx
import {tool, jsonSchema} from 'ai';

// 1. Define AI SDK native tool WITHOUT execute function
export const readFileCoreTool = tool({
	description: 'Read the contents of a file with line numbers',
	inputSchema: jsonSchema<{path: string}>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'The path to the file to read.',
			},
		},
		required: ['path'],
	}),
	// NO execute function - human-in-the-loop!
});

// 2. Define handler for manual execution
async function executeReadFile(args: {path: string}): Promise<string> {
	// Implementation
}

// 3. Export as ToolDefinition with Nanocoder extensions
export const readFileTool: ToolDefinition = {
	name: 'read_file', // Metadata for registry lookup
	tool: readFileCoreTool, // Native AI SDK tool
	handler: executeReadFile, // Manual execution after confirmation
	formatter,
	validator,
	requiresConfirmation: false,
};
```

**Benefits Achieved:**

- ✅ Automatic type inference from schema to handler
- ✅ No manual Zod conversion needed
- ✅ `jsonSchema()` accepts standard JSON Schema
- ✅ Handler function called manually after user confirmation
- ✅ Custom formatters/validators preserved

### 3. Simplified AI SDK Client

**Implementation:**

```typescript
// source/ai-sdk-client.ts
async chat(
  messages: Message[],
  tools: Record<string, AISDKCoreTool>,  // Changed from Tool[]
  signal?: AbortSignal,
): Promise<LLMChatResponse> {
  const model = this.provider(this.currentModel);

  // Tools are already in AI SDK format - pass directly (no conversion!)
  const aiTools = Object.keys(tools).length > 0 ? tools : undefined;

  const result = await generateText({
    model,
    messages: convertToModelMessages(messages),
    tools: aiTools,  // Direct pass-through!
    abortSignal: signal,
  });

  // ... rest of implementation
}
```

**Code Reduction Achieved:**

- ✅ Removed `convertToolsToAISDK()`: ~40 lines
- ✅ Removed `config` from 10 tool files: ~150 lines total
- ✅ Removed 4 test cases testing `config`: ~30 lines
- **Total: ~220 lines removed** (exceeded estimate of 175!)

### 4. MCP Tools Using AI SDK Format

**Implementation:**

```typescript
// source/mcp/mcp-client.ts
getNativeToolsRegistry(): Record<string, AISDKCoreTool> {
  const nativeTools: Record<string, AISDKCoreTool> = {};

  for (const [serverName, serverTools] of this.serverTools.entries()) {
    for (const mcpTool of serverTools) {
      const coreTool = tool({
        description: mcpTool.description
          ? `[MCP:${serverName}] ${mcpTool.description}`
          : `MCP tool from ${serverName}`,
        inputSchema: jsonSchema(mcpTool.inputSchema || {type: 'object'}),
        // No execute function - human-in-the-loop pattern
      });

      nativeTools[mcpTool.name] = coreTool;
    }
  }

  return nativeTools;
}
```

**Benefits:**

- ✅ MCP tools automatically in AI SDK format
- ✅ No adapter layer needed
- ✅ Consistent with static tools

### 5. Updated LLMClient Interface

**Implementation:**

```typescript
// source/types/core.ts
export interface LLMClient {
	chat(
		messages: Message[],
		tools: Record<string, AISDKCoreTool>, // Changed from Tool[]
		signal?: AbortSignal,
	): Promise<LLMChatResponse>;
	// ...
}
```

## Migration Status

### ✅ Phase 1: Type Aliases - COMPLETE

**Objective:** Introduce AI SDK types alongside existing types

**Completed Tasks:**

1. ✅ Added AI SDK v5 type imports in `source/types/core.ts`
2. ✅ Created `AISDKCoreTool` type alias (renamed from `Tool` to avoid conflict)
3. ✅ Updated `ToolDefinition` interface with `name` field
4. ✅ All tests passing

**Actual Effort:** ~2 hours
**Risk:** Low ✅

### ✅ Phase 2: Tool Definitions - COMPLETE

**Objective:** Migrate tool definitions to use `tool()` and `jsonSchema()`

**Completed Tasks:**

1. ✅ Created new tool definition pattern with human-in-the-loop
2. ✅ Migrated all 10 tools:
   - `read-file.tsx` ✅
   - `read-many-files.tsx` ✅
   - `create-file.tsx` ✅
   - `insert-lines.tsx` ✅
   - `replace-lines.tsx` ✅
   - `delete-lines.tsx` ✅
   - `search-files.tsx` ✅
   - `execute-bash.tsx` ✅
   - `web-search.tsx` ✅
   - `fetch-url.tsx` ✅
3. ✅ Updated `source/tools/index.ts` exports
4. ✅ Updated `ToolManager` to return `Record<string, AISDKCoreTool>`
5. ✅ Updated MCP client to return AI SDK format
6. ✅ All tests passing (272 tests)

**Actual Effort:** ~6 hours
**Risk:** Medium → Low (successful) ✅

### ⚠️ Phase 3: Message Handling - PARTIAL

**Objective:** Use proper tool message format instead of converting to user messages

**Status:** Not yet implemented. Tool results are still converted to user messages.

**Remaining Tasks:**

1. ⏸️ Update `ai-sdk-client.ts`:
   - Remove manual tool result → user message conversion
   - Use proper `CoreToolMessage` format
2. ⏸️ Update `useChatHandler.tsx`:
   - Use `CoreToolMessage` format for tool results
   - Update message construction after tool execution
3. ⏸️ Test multi-turn tool calling with proper format

**Estimated Effort:** 6-8 hours
**Risk:** Medium (core conversation handling)

**Why Deferred:** Current approach works well. This is an optimization for better multi-turn tool calling.

### ✅ Phase 4: Simplify AI SDK Client - COMPLETE

**Objective:** Remove conversion functions and simplify implementation

**Completed Tasks:**

1. ✅ Removed `convertToolsToAISDK()` function (~40 lines)
2. ✅ Removed `config` property from all tool definitions (~150 lines)
3. ✅ Simplified `chat()` and `chatStream()` methods
4. ✅ Updated `LLMClient` interface to accept `Record<string, AISDKCoreTool>`
5. ✅ Cleaned up type usage

**Actual Effort:** ~3 hours
**Risk:** Low ✅

### ⏸️ Phase 5: Evaluate MCP Client Migration - NOT STARTED

**Objective:** Assess if AI SDK's MCP client can replace custom implementation

**Status:** Deferred. Custom MCP client works well and returns AI SDK format.

**Tasks:**

1. ⏸️ Create proof-of-concept with `experimental_createMCPClient()`
2. ⏸️ Test with existing MCP servers
3. ⏸️ Verify tool format compatibility
4. ⏸️ Compare features with custom client
5. ⏸️ Decision: migrate or keep custom

**Estimated Effort:** 4-6 hours
**Risk:** Low (experimental feature, can revert)

**Recommendation:** Keep custom MCP client. It's stable and already returns AI SDK format.

### ⚠️ Phase 6: Testing & Documentation - PARTIAL

**Objective:** Ensure stability and document changes

**Completed Tasks:**

1. ✅ All unit tests pass (272 tests)
2. ✅ Tool calling tested with tool confirmation UI
3. ✅ Integration tested with multiple providers
4. ✅ MCP tool integration verified
5. ✅ Created `NATIVE-TOOLS-COMPLETE.md` migration documentation
6. ✅ Full test suite passes: `pnpm test:all`

**Remaining Tasks:**

7. ⏸️ Update `CLAUDE.md` with new architecture details
8. ⏸️ Add AI SDK v5 migration notes

**Actual Effort:** ~3 hours
**Risk:** Low ✅

## Total Actual Effort

- **Phase 1:** ~2 hours ✅
- **Phase 2:** ~6 hours ✅
- **Phase 3:** Not started ⏸️
- **Phase 4:** ~3 hours ✅
- **Phase 5:** Not started ⏸️
- **Phase 6:** ~3 hours (partial) ⚠️

**Total Completed: ~14 hours** (phases 1, 2, 4, 6 partial)

## Benefits Achieved

### Code Reduction

- ✅ Removed `convertToolsToAISDK()`: ~40 lines
- ✅ Removed `config` from all tool definitions: ~150 lines
- ✅ Removed test cases for `config`: ~30 lines
- **Total: ~220 lines removed** (exceeded estimate!)

### Quality Improvements

1. ✅ **Better Type Safety:** AI SDK's type inference catches errors at compile time
2. ✅ **Less Maintenance:** No conversion code to maintain
3. ✅ **Standards Alignment:** Using AI SDK v5 native types
4. ✅ **Future-Proof:** Direct AI SDK integration
5. ⚠️ **Proper Tool Results:** Deferred to Phase 3

### Architecture Improvements

1. ✅ **Single Source of Truth:** Tools defined once in AI SDK format
2. ✅ **No Conversion Overhead:** Direct pass-through to AI SDK
3. ✅ **Human-in-the-Loop Preserved:** Tools have no `execute` function
4. ✅ **MCP Tools Integrated:** Return AI SDK format directly
5. ✅ **Type Inference:** Automatic from JSON Schema

## Trade-offs and Key Decisions

### Trade-off: Tool Documentation

**What We Lost:**

- AI SDK's `Tool<>` type is opaque - can't extract `description` or `parameters`
- Can't auto-generate detailed tool docs in system prompt

**What We Gained:**

- LLM still receives full tool schemas through AI SDK's native mechanism
- Simpler architecture without documentation extraction logic
- Model learns tool usage from function calling

**Decision:** Acceptable trade-off. Tool schemas are passed natively to LLM.

### Decision: Human-in-the-Loop Pattern

**Choice:** Define tools WITHOUT `execute` function

**Rationale:**

- Preserves tool confirmation UI (core feature)
- Maintains security (user approves all tool executions)
- Compatible with development modes (normal/auto-accept/plan)

**Implementation:** Handlers called manually after user confirmation

### Decision: Keep Custom MCP Client

**Choice:** Don't migrate to `experimental_createMCPClient()`

**Rationale:**

- Custom client is stable and well-tested
- Already returns AI SDK native format
- More control over connection management
- Experimental API may change

**Status:** Custom MCP client updated to return AI SDK format ✅

### Decision: Defer Phase 3 (Proper Tool Messages)

**Choice:** Keep tool result → user message conversion for now

**Rationale:**

- Current approach works well
- Not blocking other improvements
- Can be done later as optimization
- Lower priority than completing Phases 1, 2, 4

**Future Work:** Implement proper `CoreToolMessage` format for better multi-turn tool calling

## Success Criteria

1. ✅ All tests pass (`pnpm test:all`)
2. ✅ Tool calling works with all providers
3. ✅ Tool confirmation UI functions correctly
4. ✅ MCP tools integrate properly
5. ⚠️ Multi-turn tool calling works (could improve with Phase 3)
6. ✅ ~175+ lines of conversion code removed (actually ~220!)
7. ✅ No regression in functionality
8. ⚠️ Documentation updated (partial - CLAUDE.md needs update)

**Overall: 6/8 Complete, 2 Partial** ✅

## Recommendation

**✅ Core Migration Complete - Phases 1, 2, 4 Successful**

The migration delivered significant benefits:

- ✅ Eliminated ~220 lines of conversion code
- ✅ All tools using AI SDK v5 native format
- ✅ Better type safety and maintainability
- ✅ Future-proof architecture
- ✅ No regressions, all tests passing

**Future Work (Optional):**

- **Phase 3:** Implement proper tool message format (optimization)
- **Phase 5:** Evaluate `experimental_createMCPClient()` (low priority)
- **Phase 6:** Complete documentation updates

## Next Steps

1. ✅ ~~Review and approve this proposal~~ APPROVED & EXECUTED
2. ✅ ~~Create feature branch: `feat/ai-sdk-native-types`~~ COMPLETED ON: `ai-sdk`
3. ✅ ~~Begin Phase 1: Type aliases~~ COMPLETE
4. ✅ ~~Iterate through phases with testing~~ COMPLETE (phases 1, 2, 4)
5. ⏸️ Consider Phase 3 for future optimization
6. ⏸️ Update CLAUDE.md with new architecture
7. ⏸️ Create pull request if working on feature branch

## AI SDK v5 Type Changes (Implemented)

Updated from AI SDK v4 to v5 type names:

**v4 → v5 Mapping:**

- `CoreToolCall` → `ToolCall` ✅
- `CoreToolResult` → `ToolResult` ✅
- `CoreToolResultUnion` → `TypedToolResult` ✅
- `CoreToolCallUnion` → `TypedToolCall` ✅
- `CoreToolChoice` → `ToolChoice` ✅
- `CoreTool` → `Tool<PARAMETERS, RESULT>` ✅ (imported as `AISDKTool` to avoid conflict)

**Note:** `CoreMessage` and related message types remain unchanged in v5.

## AI SDK UI: Should We Use It?

### What is AI SDK UI?

AI SDK UI provides React hooks (`useChat`, `useCompletion`, `useObject`) that abstract chat state management and streaming. The `useChat` hook provides:

- **State Management:** `messages`, `status`, `error`
- **Methods:** `sendMessage()`, `stop()`, `setMessages()`, `addToolResult()`
- **Auto-streaming:** Handles streaming updates automatically
- **Tool Support:** Built-in `onToolCall` and `addToolResult()` for tool calling

### Current Nanocoder State Management

**Current Implementation (1267 lines across 3 hooks):**

- `useAppState.tsx` (228 lines): 30+ state variables, setters, and utilities
- `useChatHandler.tsx` (580 lines): Message handling, tool calling flow, streaming
- `useToolHandler.tsx` (459 lines): Tool confirmation, execution, result handling

### Analysis: Should We Adopt AI SDK UI?

**❌ NO - AI SDK UI is NOT a Good Fit for Nanocoder**

Here's why:

#### 1. **Browser-Centric Design, Not Terminal-Compatible**

AI SDK UI is designed for web browsers with HTTP transports:

```typescript
// useChat expects HTTP endpoints
const {messages, sendMessage} = useChat({
	api: '/api/chat', // HTTP endpoint
	// ...
});
```

Nanocoder directly calls AI SDK Core functions (no HTTP layer):

```typescript
// Nanocoder's approach - direct client calls
const result = await client.chat(messages, tools, signal);
```

**Issue:** `useChat` assumes a client-server architecture. Nanocoder runs everything locally in the terminal without HTTP.

#### 2. **Transport Layer Mismatch**

AI SDK UI 5.0 uses a "transport" architecture:

- Messages sent to server endpoint
- Server streams responses back
- Browser receives and updates UI

Nanocoder's architecture:

- All processing happens in-process
- Direct AI SDK Core API calls
- No HTTP transport needed

**Workaround Needed:** Would need to create custom "transport" that wraps direct API calls, adding unnecessary complexity.

#### 3. **Tool Confirmation Flow Not Supported**

Nanocoder's key feature: **Manual tool confirmation**

Current flow:

1. Model proposes tool calls
2. User sees confirmation UI (one tool at a time)
3. User approves/rejects/edits
4. Tool executes
5. Result sent back to model

AI SDK UI's `useChat`:

- `onToolCall` is informational only
- `addToolResult()` expects you to execute immediately
- No built-in pause-for-confirmation pattern

**Issue:** Would need to override/hack the tool calling flow, negating the benefits of using `useChat`.

#### 4. **Development Modes Not Compatible**

Nanocoder has three modes:

- **Normal:** Tool confirmation required
- **Auto-accept:** Automatic execution
- **Plan:** Blocks file modifications

AI SDK UI: Single execution model, no mode concept.

#### 5. **Chat Queue and Component Rendering**

Nanocoder uses custom rendering:

- `chatComponents` array with React elements
- Tool formatters return React components
- Displayed via Ink's `<Static>` component
- Custom UI for tool results, errors, etc.

AI SDK UI: Message-based rendering designed for browser DOM.

#### 6. **Custom State Requirements**

Nanocoder needs state that `useChat` doesn't provide:

- `isToolConfirmationMode`, `isToolExecuting`
- `pendingToolCalls`, `currentToolIndex`, `completedToolResults`
- `developmentMode`, `isCancelling`
- `displayMessages` vs full `messages` (performance optimization)
- `messageTokenCache` for context tracking
- Mode states: `isModelSelectionMode`, `isProviderSelectionMode`, etc.

**Issue:** Would still need `useAppState` even with `useChat`, so no reduction in complexity.

#### 7. **Streaming Architecture Difference**

Nanocoder's streaming:

- Token batching (10 tokens / 75ms) for performance
- Custom `StreamingMessage` component outside `<Static>`
- Direct access to AI SDK's `textStream`

AI SDK UI: Manages streaming internally, less control over rendering.

### Verdict: Keep Custom Hooks

**Recommendation:** Do NOT migrate to AI SDK UI.

**Reasons:**

1. ✅ **Nanocoder's direct API approach is simpler** - No HTTP overhead
2. ✅ **Tool confirmation is a core feature** - Not supported by `useChat`
3. ✅ **Custom UI components** - Better suited for terminal (Ink)
4. ✅ **Development modes** - Unique to Nanocoder
5. ✅ **State requirements** - Too specialized for `useChat`
6. ✅ **Performance optimizations** - Custom batching, display limits

**What We SHOULD Do:**

- ✅ Migrate to AI SDK Core types (DONE - as per this proposal)
- ✅ Use `tool()`, `jsonSchema()`, `CoreMessage` types (DONE)
- ✅ Optionally use `experimental_createMCPClient()` (Deferred to Phase 5)
- ❌ Skip AI SDK UI - it's designed for browser web apps, not terminal apps

### Alternative: `convertToModelMessages` Utility

If we adopt AI SDK's message types (Phase 3), we might benefit from:

- `convertToModelMessages()` - Convert UI messages to model messages (if needed)
- `pruneMessages()` - Intelligent message pruning for context limits

These are standalone utilities that don't require `useChat`.

## How AI SDK Native Tool Mechanism Works

Understanding how tool schemas reach the LLM after removing `config`:

### 1. Tool Creation Phase

```typescript
const readFileCoreTool = tool({
	description: 'Read contents of a file',
	inputSchema: jsonSchema<{path: string}>({
		type: 'object',
		properties: {
			path: {type: 'string', description: 'Path to the file'},
		},
		required: ['path'],
	}),
});
```

The `tool()` function creates an opaque `Tool<PARAMETERS, RESULT>` object that internally stores the description and JSON Schema.

### 2. Schema Extraction and Formatting

When we pass tools to `generateText()` or `streamText()`:

```typescript
const result = await generateText({
	model,
	messages,
	tools: aiTools, // Record<string, AISDKCoreTool>
});
```

AI SDK internally:

1. **Extracts schemas** from each `Tool` object
2. **Converts to provider format**:
   - **OpenAI/OpenRouter:** Function calling format with `name`, `description`, `parameters`
   - **Anthropic:** Claude's tool format with `input_schema`
   - **Google:** Gemini's function declaration format
3. **Includes in API request:** Formatted tools sent to LLM

### 3. Response Processing

When the LLM responds with tool calls:

1. **Receives provider-specific format**
2. **Normalizes to unified format:** AI SDK converts all responses to standard `ToolCall` type
3. **Returns in response:** Normalized tool calls available in result

### Why This Eliminates Conversion

**Before:** Manual conversion from custom format → AI SDK format
**After:** Tools defined once in AI SDK format → passed directly

AI SDK handles all provider-specific conversions internally!

## References

- **Completion Document:** `.nanocoder/NATIVE-TOOLS-COMPLETE.md`
- **AI SDK v5 Docs:** https://sdk.vercel.ai/docs
- **Migration Branch:** `ai-sdk` (or merged to `main`)
