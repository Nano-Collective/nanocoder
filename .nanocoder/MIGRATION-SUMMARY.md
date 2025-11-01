# AI SDK Migration - Executive Summary

## TL;DR

**YES to AI SDK Core, NO to AI SDK UI**

- ✅ **Migrate to AI SDK Core native types** - Use `CoreMessage`, `tool()`, `jsonSchema()`
- ❌ **Skip AI SDK UI** - Not suitable for terminal applications
- 🎯 **Goal:** Reduce complexity, improve type safety, remove ~175 lines of conversion code

## What's Being Proposed?

### Current Issues

1. **Manual type conversions** (~175 lines of conversion code)
2. **Tool results converted to user messages** (workaround for complexity)
3. **Custom JSON Schema → Zod conversion** (~80 lines)
4. **Not leveraging AI SDK's built-in features**

### Proposed Solution

#### ✅ Phase 1-4: AI SDK Core Migration (RECOMMENDED)

**Use AI SDK's native types and utilities:**

```typescript
// BEFORE: Custom types + conversions
export interface Message {
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string;
	// ...
}
function convertMessagesToAISDK(messages: Message[]): any[] {
	/* ... */
}
function jsonSchemaToZod(schema: any): z.ZodType {
	/* ... */
}

// AFTER: AI SDK native types, no conversion
import {CoreMessage, tool, jsonSchema} from 'ai';

export type Message = CoreMessage;

const readFileTool = tool({
	description: 'Read file contents',
	inputSchema: jsonSchema({
		/* ... */
	}),
	execute: async ({path}) => {
		/* ... */
	},
});
```

**Benefits:**

- Remove ~175 lines of conversion code
- Better type safety (automatic inference)
- Proper tool message format (not converted to user messages)
- Standards-aligned architecture
- Future-proof (leverage AI SDK updates)

**Effort:** 23-34 hours across 4 phases

#### ❌ AI SDK UI: Not Recommended

**Why NOT use `useChat` and AI SDK UI?**

1. **Browser-centric design** - Expects HTTP endpoints (`api: '/api/chat'`)
2. **Nanocoder is local-first** - Direct API calls, no HTTP layer needed
3. **Tool confirmation is key** - `useChat` doesn't support pause-for-approval
4. **Development modes** - Normal/Auto-accept/Plan modes not compatible
5. **Custom rendering** - Terminal (Ink) vs Browser DOM
6. **Specialized state** - 30+ state variables specific to Nanocoder

**Verdict:** AI SDK UI adds complexity without benefits for terminal apps.

## Migration Phases

### Phase 1: Type Aliases (2-4 hours, Low Risk)

- Add AI SDK type imports alongside current types
- Gradual migration, no behavioral changes

### Phase 2: Tool Definitions (8-12 hours, Medium Risk)

- Migrate tools to use `tool()` + `jsonSchema()`
- Keep custom formatters/validators for UI
- Example: 9 tools to migrate

### Phase 3: Message Handling (6-8 hours, Medium Risk)

- Use proper `CoreToolMessage` format
- Remove conversion to user messages
- Use `response.messages` directly

### Phase 4: Simplify Client (3-4 hours, Low Risk)

- Remove conversion functions (~175 lines)
- Clean up type casts

### Phase 5: MCP Client (4-6 hours, Optional)

- Evaluate `experimental_createMCPClient()`
- Can skip and keep custom client

### Phase 6: Testing (4-6 hours, Critical)

- Full test suite
- Multi-provider testing
- Documentation updates

## Decision Matrix

| Feature            | Current           | AI SDK Core                  | AI SDK UI                    |
| ------------------ | ----------------- | ---------------------------- | ---------------------------- |
| Type conversions   | Manual (~175 LOC) | ✅ None needed               | ❌ Still needed + HTTP layer |
| Tool definitions   | JSON Schema       | ✅ `tool()` + `jsonSchema()` | ✅ Same (but with transport) |
| Tool confirmation  | ✅ Custom UI      | ✅ Keep custom               | ❌ Not supported             |
| Tool results       | User messages     | ✅ Proper ToolMessage        | ❌ Via HTTP transport        |
| State management   | 1267 LOC custom   | ✅ Keep custom               | ❌ `useChat` incompatible    |
| Direct API calls   | ✅ Yes            | ✅ Yes                       | ❌ Requires HTTP transport   |
| Terminal rendering | ✅ Ink components | ✅ Keep Ink                  | ❌ DOM-based                 |
| Development modes  | ✅ 3 modes        | ✅ Keep modes                | ❌ Not supported             |

## Recommendation

**Proceed with Phases 1-4 of AI SDK Core migration, skip AI SDK UI entirely.**

**Rationale:**

1. AI SDK Core: Perfect fit - reduces complexity, improves types
2. AI SDK UI: Wrong abstraction - designed for web browsers, not terminals
3. Nanocoder's custom hooks are actually simpler than forcing `useChat` to work

## Utilities We COULD Use

Even without AI SDK UI, these might help:

- `pruneMessages()` - Intelligent message pruning for context limits
- `convertToModelMessages()` - If we need UI ↔ Model message conversion

## Next Steps

1. **Review proposal** - Read full proposal in `AI-SDK-MIGRATION-PROPOSAL.md`
2. **Approve phases** - Decide on Phases 1-4 (recommended) vs including Phase 5 (MCP)
3. **Create branch** - `feat/ai-sdk-native-types`
4. **Start Phase 1** - Low-risk type aliases
5. **Iterate** - One phase at a time with testing

## Questions?

See full proposal for:

- Detailed code examples
- Risk assessment and mitigation
- Success criteria
- Discussion questions

## Files

- `AI-SDK-MIGRATION-PROPOSAL.md` - Full detailed proposal (~600 lines)
- `MIGRATION-SUMMARY.md` - This executive summary
