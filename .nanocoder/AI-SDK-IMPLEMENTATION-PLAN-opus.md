# AI SDK Simplification Implementation Plan

## Executive Summary

This is a step-by-step implementation plan to simplify the nanocoder codebase by removing unnecessary complexity while maintaining all functionality. The plan follows KISS and YAGNI principles to reduce code by ~40% and make the codebase more maintainable.

**Core Principles:**

- ✅ Keep what works (AI SDK v5 integration, human-in-the-loop)
- ❌ Remove duplication (multiple registries, format conversions)
- 🎯 Single source of truth for each concern
- 📝 Clear, testable code

## Implementation Order

The phases are ordered by **risk level** and **dependency chain** to ensure safe, incremental changes:

### 🟢 Phase 1: Remove MCPToolAdapter (Low Risk)

**Duration:** 1-2 hours  
**Why First:** Isolated change, removes unnecessary conversion layer

### 🟢 Phase 2: Consolidate Tool Registries (Medium Risk)

**Duration:** 3-4 hours  
**Why Second:** Central improvement that simplifies tool management

### 🟢 Phase 3: Extract Tool Calling Logic (Low Risk)

**Duration:** 2-3 hours  
**Why Third:** Prepares for client simplification, improves separation of concerns

### 🟡 Phase 4: Simplify MCP Integration (Medium Risk)

**Duration:** 2 hours  
**Why Fourth:** Depends on Phase 2, continues MCP cleanup

### 🟡 Phase 5: Simplify AI SDK Client (Medium Risk)

**Duration:** 2-3 hours  
**Why Fifth:** Depends on Phase 3, makes client focused

### 🔴 Phase 6: Unify Message Format (High Risk - Optional)

**Duration:** 4-6 hours  
**Why Last:** Affects many files, can be deferred if needed

---

## Detailed Implementation Steps

## 🟢 Phase 1: Remove MCPToolAdapter

### Objective

Eliminate the unnecessary MCPToolAdapter layer that converts MCP tools through multiple formats.

### Step-by-Step Actions

#### Step 1.1: Analyze Current Usage

```bash
# Check how MCPToolAdapter is used
grep -r "MCPToolAdapter" source/
```

#### Step 1.2: Update tool-manager.ts

```typescript
// File: source/tools/tool-manager.ts

// REMOVE these imports:
- import { MCPToolAdapter } from '../mcp/mcp-tool-adapter.js';

// REMOVE this property:
- private mcpAdapter: MCPToolAdapter | null = null;

// UPDATE initializeMCP() method:
async initializeMCP(mcpServers?: MCPServerConfig[]): Promise<void> {
  if (this.mcpClient) {
    await this.mcpClient.close();
  }

  this.mcpClient = new MCPClient();
  await this.mcpClient.connectToServers(mcpServers);

  // REMOVE these lines:
  - this.mcpAdapter = new MCPToolAdapter(this.mcpClient);
  - this.mcpAdapter.registerMCPTools(this.toolRegistry);

  // ADD direct registry merge:
  const mcpTools = this.mcpClient.getNativeToolsRegistry();
  Object.assign(this.nativeToolsRegistry, mcpTools);
}
```

#### Step 1.3: Delete Adapter File

```bash
# Delete the adapter file
rm source/mcp/mcp-tool-adapter.ts
```

#### Step 1.4: Test

```bash
# Run tests to ensure MCP tools still work
pnpm test:all
```

### Verification Checklist

- [ ] MCPToolAdapter imports removed
- [ ] MCP tools still appear in tool list
- [ ] MCP tool execution works
- [ ] All tests pass

---

## 🟢 Phase 2: Consolidate Tool Registries

### Objective

Merge 4 separate registries into a single source of truth with metadata.

### Step-by-Step Actions

#### Step 2.1: Define New ToolEntry Type

```typescript
// File: source/types/core.ts

// ADD this interface:
export interface ToolEntry {
	// AI SDK native tool for LLM
	tool: CoreTool<any, any>;

	// Execution handler (human-in-the-loop)
	execute: (args: any) => Promise<string>;

	// Optional UI formatter for Ink CLI
	formatter?: (args: any, result?: string) => React.ReactElement | string;

	// Optional validator
	validator?: (args: any) => Promise<{valid: boolean; error?: string}>;
}

// REMOVE old ToolDefinition interface if exists
```

#### Step 2.2: Update Tool Manager

```typescript
// File: source/tools/tool-manager.ts

export class ToolManager {
  // REPLACE multiple registries with single one:
  private toolRegistry: Record<string, ToolEntry> = {};

  // REMOVE these:
  - private toolRegistry: Record<string, ToolHandler> = {};
  - private toolFormatters: Record<string, ToolFormatter> = {};
  - private toolValidators: Record<string, ToolValidator> = {};
  - private nativeToolsRegistry: Record<string, AISDKCoreTool> = {};

  constructor() {
    // Initialize with static tools
    this.initializeStaticTools();
  }

  private initializeStaticTools(): void {
    // Import all static tools
    this.toolRegistry = {
      read_file: readFileTool,
      create_file: createFileTool,
      replace_lines: replaceLinesTool,
      // ... other tools
    };
  }

  // SIMPLIFY getters:
  getAllTools(): Record<string, CoreTool> {
    const tools: Record<string, CoreTool> = {};
    for (const [name, entry] of Object.entries(this.toolRegistry)) {
      tools[name] = entry.tool;
    }
    return tools;
  }

  async executeTool(name: string, args: any): Promise<string> {
    const entry = this.toolRegistry[name];
    if (!entry) {
      throw new Error(`Tool not found: ${name}`);
    }
    return entry.execute(args);
  }

  getToolFormatter(name: string): ToolFormatter | undefined {
    return this.toolRegistry[name]?.formatter;
  }

  getToolValidator(name: string): ToolValidator | undefined {
    return this.toolRegistry[name]?.validator;
  }
}
```

#### Step 2.3: Update Individual Tool Files

```typescript
// Example: source/tools/read-file.ts

import {tool} from 'ai';
import {z} from 'zod';
import type {ToolEntry} from '../types/core.js';

export const readFileTool: ToolEntry = {
	tool: tool({
		description: 'Read file contents with line numbers',
		parameters: z.object({
			path: z.string().describe('The path to the file to read'),
		}),
	}),

	async execute(args: {path: string}): Promise<string> {
		// Existing implementation
		const content = await fs.readFile(args.path, 'utf-8');
		return addLineNumbers(content);
	},

	formatter(args: {path: string}, result?: string) {
		return <ReadFileUI args={args} result={result} />;
	},

	validator: async (args: {path: string}) => {
		if (!(await fs.pathExists(args.path))) {
			return {valid: false, error: 'File does not exist'};
		}
		return {valid: true};
	},
};
```

#### Step 2.4: Update Tool Exports

```typescript
// File: source/tools/index.ts

// Export individual tools
export {readFileTool} from './read-file.js';
export {createFileTool} from './create-file.js';
// ... other exports

// Export consolidated registry
export const staticToolRegistry: Record<string, ToolEntry> = {
	read_file: readFileTool,
	create_file: createFileTool,
	// ... other tools
};
```

### Verification Checklist

- [ ] Single toolRegistry with ToolEntry type
- [ ] All tool files updated to new format
- [ ] Tool execution works
- [ ] Tool formatting works in UI
- [ ] Tests pass

---

## 🟢 Phase 3: Extract Tool Calling Logic

### Objective

Move tool calling logic out of AI SDK client into dedicated handler.

### Step-by-Step Actions

#### Step 3.1: Create Tool Call Handler

```typescript
// File: source/tool-calling/tool-call-handler.ts

import type {ToolCall} from 'ai';
import {XMLToolCallParser} from './xml-tool-call-parser.js';
import type {ToolEntry} from '../types/core.js';

export class ToolCallHandler {
	constructor(
		private tools: Record<string, ToolEntry>,
		private xmlFallback: boolean = true,
	) {}

	// Extract tool calls from LLM response
	extractToolCalls(response: {
		text: string;
		toolCalls?: ToolCall[];
	}): ToolCall[] {
		// Use native tool calls if available
		if (response.toolCalls && response.toolCalls.length > 0) {
			return response.toolCalls;
		}

		// Fallback to XML parsing if enabled
		if (this.xmlFallback && response.text) {
			return XMLToolCallParser.parse(response.text);
		}

		return [];
	}

	// Execute a tool call
	async executeToolCall(toolCall: ToolCall): Promise<string> {
		const tool = this.tools[toolCall.toolName];
		if (!tool) {
			throw new Error(`Tool not found: ${toolCall.toolName}`);
		}

		// Validate if validator exists
		if (tool.validator) {
			const validation = await tool.validator(toolCall.args);
			if (!validation.valid) {
				throw new Error(validation.error || 'Validation failed');
			}
		}

		// Execute the tool
		return tool.execute(toolCall.args);
	}

	// Format tool for display
	formatToolCall(
		toolCall: ToolCall,
		result?: string,
	): React.ReactElement | string {
		const tool = this.tools[toolCall.toolName];
		if (tool?.formatter) {
			return tool.formatter(toolCall.args, result);
		}

		// Default formatting
		return `${toolCall.toolName}(${JSON.stringify(toolCall.args)})`;
	}
}
```

#### Step 3.2: Move XML Parser

```typescript
// File: source/tool-calling/xml-tool-call-parser.ts

// MOVE from ai-sdk-client.ts to here
export class XMLToolCallParser {
	static parse(content: string): ToolCall[] {
		// Existing XML parsing logic
		const toolCalls: ToolCall[] = [];
		const regex = /<tool_call>(.*?)<\/tool_call>/gs;

		let match;
		while ((match = regex.exec(content)) !== null) {
			try {
				const toolCallContent = match[1];
				const nameMatch = /<tool_name>(.*?)<\/tool_name>/s.exec(
					toolCallContent,
				);
				const argsMatch = /<parameters>(.*?)<\/parameters>/s.exec(
					toolCallContent,
				);

				if (nameMatch && argsMatch) {
					toolCalls.push({
						toolCallId: crypto.randomUUID(),
						toolName: nameMatch[1].trim(),
						args: JSON.parse(argsMatch[1]),
					});
				}
			} catch (error) {
				// Skip malformed tool calls
			}
		}

		return toolCalls;
	}

	static hasToolCalls(content: string): boolean {
		return /<tool_call>/.test(content);
	}
}
```

#### Step 3.3: Simplify AI SDK Client

```typescript
// File: source/ai-sdk-client.ts

export class AISDKClient implements LLMClient {
  // REMOVE XML parsing logic
  // REMOVE message conversion if using CoreMessage types

  async chat(
    messages: CoreMessage[],
    tools: Record<string, CoreTool>,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    const result = await generateText({
      model: this.provider(this.currentModel),
      messages,
      tools,
      abortSignal: signal,
    });

    // Return clean response
    return {
      content: result.text,
      toolCalls: result.toolCalls,
      usage: result.usage,
    };
  }

  async streamChat(
    messages: CoreMessage[],
    tools: Record<string, CoreTool>,
    signal?: AbortSignal,
  ): AsyncIterable<ChatStreamChunk> {
    const stream = await streamText({
      model: this.provider(this.currentModel),
      messages,
      tools,
      abortSignal: signal,
    });

    // Stream chunks
    for await (const chunk of stream.textStream) {
      yield { type: 'text', content: chunk };
    }
  }
}
```

### Verification Checklist

- [ ] ToolCallHandler created and working
- [ ] XML parsing moved to separate module
- [ ] AI SDK client simplified
- [ ] Tool execution still works
- [ ] Tests pass

---

## 🟡 Phase 4: Simplify MCP Integration

### Objective

Direct MCP to AI SDK tool conversion without intermediate steps.

### Step-by-Step Actions

#### Step 4.1: Update MCP Client

```typescript
// File: source/mcp/mcp-client.ts

export class MCPClient {
	// ADD method for direct tool conversion
	getToolEntries(): Record<string, ToolEntry> {
		const entries: Record<string, ToolEntry> = {};

		for (const [serverName, serverTools] of this.serverTools) {
			for (const mcpTool of serverTools) {
				const toolName = `${serverName}_${mcpTool.name}`;

				entries[toolName] = {
					tool: tool({
						description: `[MCP:${serverName}] ${mcpTool.description}`,
						parameters: jsonSchema(mcpTool.inputSchema),
					}),

					execute: async (args: any) => {
						const result = await this.callTool(mcpTool.name, args);
						return typeof result === 'string' ? result : JSON.stringify(result);
					},

					// MCP tools don't have custom formatters/validators
					formatter: undefined,
					validator: undefined,
				};
			}
		}

		return entries;
	}

	// DEPRECATE but keep for compatibility
	getNativeToolsRegistry(): Record<string, AISDKCoreTool> {
		const entries = this.getToolEntries();
		const tools: Record<string, AISDKCoreTool> = {};
		for (const [name, entry] of Object.entries(entries)) {
			tools[name] = entry.tool;
		}
		return tools;
	}
}
```

#### Step 4.2: Update Tool Manager MCP Integration

```typescript
// File: source/tools/tool-manager.ts

async initializeMCP(mcpServers?: MCPServerConfig[]): Promise<void> {
  if (this.mcpClient) {
    await this.mcpClient.close();
  }

  this.mcpClient = new MCPClient();
  await this.mcpClient.connectToServers(mcpServers);

  // Direct merge of MCP tools
  const mcpTools = this.mcpClient.getToolEntries();
  Object.assign(this.toolRegistry, mcpTools);
}
```

#### Step 4.3: Optional - Rename MCPClient

```typescript
// Consider renaming for clarity (optional)
// source/mcp/mcp-client.ts → source/mcp/mcp-tool-manager.ts
export class MCPToolManager {
	// was MCPClient
	// ... same implementation
}
```

### Verification Checklist

- [ ] MCP tools converted directly to ToolEntry
- [ ] No intermediate conversion steps
- [ ] MCP tool execution works
- [ ] Tests pass

---

## 🟡 Phase 5: Simplify AI SDK Client

### Objective

Focus AI SDK client on API communication only.

### Step-by-Step Actions

#### Step 5.1: Remove Unnecessary Features

```typescript
// File: source/ai-sdk-client.ts

export class AISDKClient implements LLMClient {
  // REMOVE these if not used:
  - private modelInfoCache: Map<string, ModelInfo> = new Map();
  - private async cacheModelInfo(): Promise<void> { ... }

  // SIMPLIFY constructor
  constructor(config: LLMProviderConfig) {
    this.provider = createOpenAICompatible({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      headers: this.getHeaders(config),
      fetch: this.createFetch(config),
    });

    this.currentModel = config.model;
  }

  // FOCUS on core methods only
  async chat(...): Promise<ChatResponse> { ... }
  async streamChat(...): AsyncIterable<ChatStreamChunk> { ... }

  // REMOVE complex logic that belongs elsewhere
}
```

#### Step 5.2: Clean Up Imports

```typescript
// Remove unused imports
- import { XMLToolCallParser } from './xml-tool-call-parser.js';
- import { convertToModelMessages } from './message-converter.js';
```

### Verification Checklist

- [ ] Client focused on API communication
- [ ] No XML parsing in client
- [ ] Clean, simple methods
- [ ] Tests pass

---

## 🔴 Phase 6: Unify Message Format (Optional - High Risk)

### Objective

Use AI SDK's CoreMessage types throughout the application.

### ⚠️ WARNING: This affects many files and may break existing functionality. Consider deferring.

### Step-by-Step Actions

#### Step 6.1: Update Core Types

```typescript
// File: source/types/core.ts

// Use AI SDK types directly
import type {CoreMessage} from 'ai';

export type Message = CoreMessage;
export type {
	CoreUserMessage,
	CoreAssistantMessage,
	CoreSystemMessage,
} from 'ai';
```

#### Step 6.2: Update All Components

```bash
# Find all files using Message type
grep -r "Message" source/ --include="*.ts" --include="*.tsx"

# Update each file to use CoreMessage types
# This is a large change affecting 30+ files
```

#### Step 6.3: Remove Conversion Functions

```typescript
// DELETE these files/functions:
-source / utils / message -
	converter.ts -
	convertToModelMessages() -
	convertFromModelMessages();
```

### Verification Checklist

- [ ] All components use CoreMessage
- [ ] No message conversion needed
- [ ] Message history works
- [ ] Extensive testing completed

---

## Testing Strategy

### After Each Phase

```bash
# Run full test suite
pnpm test:all

# Manual testing checklist
- [ ] Can start the CLI
- [ ] Can chat with LLM
- [ ] Static tools work (read_file, create_file, etc.)
- [ ] MCP tools work (if MCP servers configured)
- [ ] Tool confirmation UI works
- [ ] Streaming responses work
```

### Integration Testing

```bash
# Test with real LLM
npm run dev
# Try: "Read the package.json file"
# Try: "Create a test file"
# Try: "Search for TODO comments"
```

---

## Rollback Plan

Each phase is atomic and can be reverted:

```bash
# If a phase fails, revert it
git stash  # Save any uncommitted work
git checkout main
git pull
git checkout -b retry-phase-X

# Or revert specific commit
git revert <commit-hash>
```

---

## Success Metrics

### Quantitative

- [ ] Code reduction: ~40% fewer lines
- [ ] File count: Remove at least 3 files
- [ ] Type complexity: Fewer custom types
- [ ] Test coverage: Maintain >80%

### Qualitative

- [ ] Easier to understand tool flow
- [ ] Clear separation of concerns
- [ ] Simpler onboarding for new contributors
- [ ] Better error messages

---

## Next Immediate Actions

1. **Start with Phase 1** (Remove MCPToolAdapter):

   ```bash
   git checkout -b simplify/remove-mcp-adapter
   # Follow Phase 1 steps
   pnpm test:all
   git commit -m "refactor: remove unnecessary MCPToolAdapter layer"
   ```

2. **Continue to Phase 2** (Consolidate Registries):

   ```bash
   git checkout -b simplify/consolidate-registries
   # Follow Phase 2 steps
   pnpm test:all
   git commit -m "refactor: consolidate tool registries into single source of truth"
   ```

3. **Document changes** in CLAUDE.md after each phase

---

## Questions to Resolve Before Starting

1. **Ink UI Components**: Confirm that tool formatters/validators are essential for CLI UX
2. **Breaking Changes**: Is it acceptable to change internal APIs?
3. **MCP Compatibility**: Must maintain full MCP protocol support?
4. **Message History**: Can existing chat histories be migrated if message format changes?

---

## Summary

This plan provides a clear, testable path to simplify the nanocoder codebase while maintaining all functionality. Start with Phase 1 (lowest risk) and progress incrementally. Each phase is independent enough to be completed, tested, and deployed separately.

**Remember**: The goal is SIMPLICITY. If something seems complex, it probably is. Follow KISS and YAGNI principles throughout.
