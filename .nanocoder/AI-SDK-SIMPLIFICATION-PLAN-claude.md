# AI SDK Integration Simplification Plan

**Goal**: Simplify the AI SDK v5 integration following KISS and YAGNI principles for easier understanding by new contributors.

## Current Architecture Analysis

### ✅ What's Good (Keep)

1. **AI SDK v5 Native Integration**: Using `@ai-sdk/openai-compatible` with `generateText()` and `streamText()`
2. **Human-in-the-Loop Pattern**: Tools don't auto-execute, requiring user confirmation
3. **Dual Tool Calling**: Native + XML fallback for non-supporting models
4. **Clean Separation**: LLM client, tool manager, and MCP are separate concerns

### ⚠️ What's Complex (Simplify)

#### 1. **Dual Message Format (UNNECESSARY)**

- **Current**: Internal OpenAI format → Convert to ModelMessage at boundary
- **Problem**: Extra conversion layer, cognitive overhead
- **Solution**: Use AI SDK's `CoreMessage` types throughout

#### 2. **Redundant Tool Registries (3 REGISTRIES!)**

```typescript
// Current (source/tools/tool-manager.ts)
- toolRegistry: Record<string, ToolHandler>           // For execution
- toolFormatters: Record<string, ToolFormatter>       // For UI
- toolValidators: Record<string, ToolValidator>       // For validation
- nativeToolsRegistry: Record<string, AISDKCoreTool>  // For AI SDK
```

**Problem**: Too many registries for the same tools
**Solution**: Single registry with tool metadata

#### 3. **MCP Tool Conversion Complexity**

- **Current**: MCP tools → Tool format → AISDKCoreTool format → Handler registration
- **Problem**: Multiple conversion steps
- **Solution**: Direct MCP → AISDKCoreTool conversion

#### 4. **XML Parser in AI SDK Client**

- **Current**: XML parsing logic inside `ai-sdk-client.ts`
- **Problem**: Mixes concerns (client should focus on API communication)
- **Solution**: Move to tool-calling layer

---

## Simplification Plan

### Phase 1: Unify Message Format ✨

**Change**: Use AI SDK's `CoreMessage` types everywhere

**Files to modify**:

- `source/types/core.ts` - Update Message type
- `source/ai-sdk-client.ts` - Remove conversion function
- All components using Message type

**Before**:

```typescript
// Internal format
interface Message {
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
	name?: string;
}

// Convert at boundary
function convertToModelMessages(messages: Message[]): ModelMessage[];
```

**After**:

```typescript
// Use AI SDK types directly
import type {CoreMessage, CoreUserMessage, CoreAssistantMessage} from 'ai';
export type Message = CoreMessage;
```

**Benefits**:

- Remove `convertToModelMessages()` function
- Remove message format conversion logic
- Simpler mental model for contributors
- Type safety from AI SDK

---

### Phase 2: Single Tool Registry 🎯

**Change**: Consolidate 4 registries into 1 with metadata

**Files to modify**:

- `source/tools/index.ts`
- `source/tools/tool-manager.ts`
- Individual tool files (read-file.ts, etc.)

**Before**:

```typescript
// 4 separate registries
toolRegistry: Record<string, ToolHandler>;
toolFormatters: Record<string, ToolFormatter>;
toolValidators: Record<string, ToolValidator>;
nativeToolsRegistry: Record<string, AISDKCoreTool>;
```

**After**:

```typescript
// Single registry with metadata
interface ToolEntry {
	// AI SDK native tool (for LLM)
	tool: CoreTool<any, any>;

	// Execution handler (human-in-the-loop)
	execute: (args: any) => Promise<string>;

	// Optional metadata
	formatter?: (args: any, result?: string) => React.ReactElement | string;
	validator?: (args: any) => Promise<{valid: boolean; error?: string}>;
}

const toolRegistry: Record<string, ToolEntry> = {
	read_file: {
		tool: readFileTool,
		execute: readFileHandler,
		formatter: readFileFormatter,
	},
	// ...
};
```

**Benefits**:

- Single source of truth
- Tools are self-contained
- Easy to add/remove tools
- Clear structure for contributors

---

### Phase 3: Simplify Tool Definition Pattern 📝

**Change**: Standardize how tools are defined

**Current Pattern** (complex):

```typescript
export const readFileTool: ToolDefinition = {
  name: 'read_file',
  tool: tool({
    description: '...',
    inputSchema: jsonSchema({...}),
  }),
  handler: async (input) => {...},
  formatter: (args) => {...},
  validator: async (args) => {...},
};
```

**New Pattern** (simple):

```typescript
// source/tools/read-file.ts
export const readFile = {
	tool: tool({
		description: 'Read file contents with line numbers',
		parameters: z.object({
			path: z.string().describe('File path'),
		}),
	}),

	async execute(args: {path: string}): Promise<string> {
		// Implementation
	},

	formatter(args: {path: string}, result?: string) {
		return <ReadFileUI args={args} result={result} />;
	},
} satisfies ToolEntry;
```

**Benefits**:

- No separate ToolDefinition type needed
- Type inference from zod schema
- Clearer execution flow
- Less boilerplate

---

### Phase 4: Clean MCP Integration 🔌

**Change**: Direct MCP → AI SDK conversion

**Files to modify**:

- `source/mcp/mcp-client.ts`
- `source/mcp/mcp-tool-adapter.ts`
- `source/tools/tool-manager.ts`

**Before** (too many steps):

```typescript
// MCP Tool → Nanocoder Tool → AISDKCoreTool → Handler registration
getNativeToolsRegistry(): Record<string, AISDKCoreTool>
registerMCPTools(toolRegistry: Record<string, ToolHandler>): void
```

**After** (direct):

```typescript
class MCPClient {
	// Convert MCP tools directly to ToolEntry format
	getTools(): Record<string, ToolEntry> {
		const tools: Record<string, ToolEntry> = {};

		for (const [serverName, serverTools] of this.serverTools) {
			for (const mcpTool of serverTools) {
				tools[mcpTool.name] = {
					tool: tool({
						description: `[MCP:${serverName}] ${mcpTool.description}`,
						parameters: mcpTool.inputSchema,
					}),
					execute: async args => this.callTool(mcpTool.name, args),
				};
			}
		}

		return tools;
	}
}
```

**Benefits**:

- No adapter layer needed
- Direct conversion
- Consistent with static tools
- Remove `MCPToolAdapter` class

---

### Phase 5: Simplify AI SDK Client 🚀

**Change**: Focus on API communication only

**Files to modify**:

- `source/ai-sdk-client.ts`

**Remove**:

- XML parser logic (move to separate tool-calling layer)
- Message conversion (Phase 1)
- Model info caching (YAGNI - not used)

**Before** (mixed concerns):

```typescript
async chat(messages: Message[], tools: Record<string, AISDKCoreTool>) {
  const modelMessages = convertToModelMessages(messages); // Remove
  const result = await generateText({...});

  // XML parsing in client (wrong layer)
  if (XMLToolCallParser.hasToolCalls(content)) {
    const xmlToolCalls = XMLToolCallParser.parseToolCalls(content);
    // ...
  }
}
```

**After** (focused):

```typescript
async chat(messages: CoreMessage[], tools: Record<string, CoreTool>) {
  const result = await generateText({
    model: this.provider(this.currentModel),
    messages,
    tools,
    abortSignal: signal,
  });

  return {
    content: result.text,
    toolCalls: result.toolCalls, // AI SDK handles this
  };
}
```

**Benefits**:

- Client does one thing well: API communication
- XML parsing moves to tool-calling layer
- Simpler error handling
- Easier to test

---

### Phase 6: Extract Tool Calling Logic 🔧

**Change**: Dedicated tool calling layer

**New file**: `source/tool-calling/tool-call-handler.ts`

```typescript
export class ToolCallHandler {
	constructor(
		private tools: Record<string, ToolEntry>,
		private xmlFallback: boolean = true,
	) {}

	// Extract tool calls from response
	extractToolCalls(response: LLMResponse): ToolCall[] {
		const toolCalls = response.toolCalls || [];

		// Fallback to XML if enabled and no native calls
		if (this.xmlFallback && toolCalls.length === 0 && response.content) {
			return XMLToolCallParser.parse(response.content);
		}

		return toolCalls;
	}

	// Execute a tool call
	async executeToolCall(toolCall: ToolCall): Promise<string> {
		const tool = this.tools[toolCall.toolName];
		if (!tool) throw new Error(`Tool not found: ${toolCall.toolName}`);

		return tool.execute(toolCall.args);
	}
}
```

**Benefits**:

- Clear separation of concerns
- Testable in isolation
- XML fallback is explicit
- Reusable across client types

---

## Migration Steps (Recommended Order)

### Step 1: Phase 2 (Tool Registry) - Low Risk ✅

**Why first**: Internal refactor, doesn't affect external API
**Effort**: 4 hours
**Files**: ~15 files (tool definitions + tool-manager)

### Step 2: Phase 3 (Tool Definition Pattern) - Low Risk ✅

**Why second**: Builds on Phase 2, improves DX
**Effort**: 3 hours
**Files**: ~10 tool files

### Step 3: Phase 6 (Tool Calling Layer) - Medium Risk ⚠️

**Why third**: Prepares for client simplification
**Effort**: 3 hours
**Files**: 3 new files, modify ai-sdk-client.ts

### Step 4: Phase 4 (MCP Integration) - Medium Risk ⚠️

**Why fourth**: Depends on Phase 2 registry changes
**Effort**: 2 hours
**Files**: mcp-client.ts, remove mcp-tool-adapter.ts

### Step 5: Phase 5 (Client Simplification) - Medium Risk ⚠️

**Why fifth**: Depends on Phase 6
**Effort**: 2 hours
**Files**: ai-sdk-client.ts

### Step 6: Phase 1 (Message Format) - High Risk 🔴

**Why last**: Affects many components, needs careful migration
**Effort**: 6 hours
**Files**: ~30 files (all components using messages)

---

## Code Reduction Estimate

| Component          | Before (LOC) | After (LOC) | Reduction |
| ------------------ | ------------ | ----------- | --------- |
| Tool Manager       | 184          | 80          | -56%      |
| AI SDK Client      | 459          | 200         | -56%      |
| MCP Adapter        | 60           | 0           | -100%     |
| Tool Definitions   | ~2255        | ~1500       | -33%      |
| Message Conversion | 132          | 0           | -100%     |
| **Total**          | **~3090**    | **~1780**   | **-42%**  |

---

## Success Metrics

### Code Quality

- [ ] Single source of truth for tools
- [ ] No duplicate type conversions
- [ ] Clear separation of concerns
- [ ] <200 LOC per file average

### Developer Experience

- [ ] New tool added in <50 LOC
- [ ] Tool execution flow clear in <5 files
- [ ] No need to understand message conversion
- [ ] MCP integration obvious from code

### Maintainability

- [ ] Each file has single responsibility
- [ ] Dependencies flow in one direction
- [ ] Easy to add new LLM providers
- [ ] Test coverage >80%

---

## Example: Adding a New Tool (After Simplification)

### Before (Complex - 4 registries):

```typescript
// 1. Define tool
export const myTool: ToolDefinition = {
  name: 'my_tool',
  tool: tool({ description: '...', inputSchema: jsonSchema({...}) }),
  handler: async (input) => {...},
  formatter: (args) => {...},
};

// 2. Add to toolDefinitions array in index.ts
// 3. Export appears in toolRegistry
// 4. Export appears in nativeToolsRegistry
// 5. Export appears in toolFormatters
```

### After (Simple - 1 registry):

```typescript
// 1. Create tool file
export const myTool = {
	tool: tool({
		description: 'My tool',
		parameters: z.object({arg: z.string()}),
	}),
	async execute(args) {
		/* ... */
	},
} satisfies ToolEntry;

// 2. Add to registry
import {myTool} from './my-tool';
toolRegistry.my_tool = myTool;
```

**Result**: 50% less code, 100% clearer

---

## Risk Mitigation

### Testing Strategy

1. **Unit tests**: Each phase has test coverage before merge
2. **Integration tests**: Keep existing paste-roundtrip tests
3. **Manual testing**: Test with real LLM after each phase

### Rollback Plan

1. Each phase is a separate PR with atomic commits
2. Feature flags for new behavior (if needed)
3. Can revert individual phases without breaking others

### Documentation

1. Update CLAUDE.md after each phase
2. Add JSDoc comments to new patterns
3. Create CONTRIBUTING.md with tool creation guide

---

## Next Actions for LLM Agent

### Immediate (Start with Phase 2)

```bash
# 1. Create feature branch
git checkout -b simplify/tool-registry

# 2. Update tool types
# Edit: source/types/core.ts
# Add: ToolEntry interface
# Remove: ToolDefinition interface

# 3. Consolidate registries in tool-manager.ts
# Merge 4 registries into 1

# 4. Update individual tools
# Refactor each tool to new pattern

# 5. Run tests
pnpm test:all

# 6. Create PR with clear description
```

### Command Checklist

- [ ] Read `source/types/core.ts` and update ToolEntry interface
- [ ] Read `source/tools/tool-manager.ts` and simplify registries
- [ ] Read one tool file (e.g., `source/tools/read-file.ts`) as template
- [ ] Update all 10 tool files to new pattern
- [ ] Update `source/tools/index.ts` exports
- [ ] Run `pnpm test:all` to verify
- [ ] Update CLAUDE.md with new patterns

---

## Questions for Project Maintainer

1. **Message Format**: OK to switch to `CoreMessage` everywhere? (Breaks existing message history)
2. **Zod vs JSON Schema**: Prefer `zod` for type safety or keep `jsonSchema()`?
3. **MCP Adapter**: OK to remove adapter and merge into MCPClient?
4. **Tool Confirmation**: Keep current UI or simplify?
5. **Breaking Changes**: OK to break compatibility for simpler architecture?

---

## Summary

This plan reduces codebase complexity by **42%** while following AI SDK v5 best practices:

✅ **KISS**: Single registry, direct conversions, focused components
✅ **YAGNI**: Remove unused features (model info cache, dual formats)
✅ **DRY**: Eliminate duplicate registries and conversions
✅ **Clear**: Each file has one job, easy to understand

**Recommended Start**: Phase 2 (Tool Registry) - immediate value, low risk.
