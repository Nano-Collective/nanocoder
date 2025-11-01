# Phase 2: Tool Definitions Migration - Status

## Progress: COMPLETE ✅✅✅

### What's Been Done

1. **All 10 Tools Successfully Migrated ✅**

   - ✅ `read-file.tsx` - File reading with line numbers
   - ✅ `create-file.tsx` - File creation
   - ✅ `insert-lines.tsx` - Line insertion
   - ✅ `replace-lines.tsx` - Line replacement
   - ✅ `delete-lines.tsx` - Line deletion
   - ✅ `read-many-files.tsx` - Bulk file reading
   - ✅ `execute-bash.tsx` - Bash command execution
   - ✅ `web-search.tsx` - Web search via Brave
   - ✅ `fetch-url.tsx` - URL fetching via Jina AI
   - ✅ `search-files.tsx` - Ripgrep-based code search

2. **Migration Pattern Established and Applied**

   ```typescript
   // 1. Shared execute function
   const executeReadFile = async (args: {path: string}): Promise<string> => {
     // Implementation here
   };

   // 2. AI SDK tool definition
   const readFileCoreTool = tool({
     description: '...',
     inputSchema: jsonSchema<{path: string}>({...}),
     execute: executeReadFile,
   });

   // 3. Nanocoder tool definition (maintains compatibility)
   export const readFileTool: ToolDefinition = {
     handler: executeReadFile,  // Reuses same function
     formatter,                  // Custom UI formatter
     validator,                  // Custom validation
     requiresConfirmation: false,
     config: {...}              // Keep for Phase 3 migration
   };

   // 4. Export core tool for Phase 3-4
   export {readFileCoreTool};
   ```

### Benefits Demonstrated

1. ✅ **Type Safety**: AI SDK's `jsonSchema<T>()` provides automatic type inference
2. ✅ **Code Reuse**: Same `execute` function used by both formats
3. ✅ **Backward Compatible**: Existing tool confirmation UI still works
4. ✅ **No Breaking Changes**: All existing code continues to work
5. ✅ **Future-Ready**: Core tools exported for Phase 3-4 migration

### Time Spent

- **POC (read-file.tsx)**: ~30 minutes
- **Second tool (create-file.tsx)**: ~15 minutes
- **Remaining 8 tools**: ~2 hours
- **Testing & knip config**: ~30 minutes
- **Total Phase 2**: ~3 hours 15 minutes

### Key Learnings from POC

1. **Pattern Works Well**: The dual-definition approach maintains compatibility while preparing for migration
2. **No Schema Conversion Needed**: AI SDK's `jsonSchema()` accepts standard JSON Schema directly
3. **Type Inference Works**: TypeScript correctly infers types from `jsonSchema<T>()`
4. **Execute Functions Simple**: Just need to match the signature `(args: T) => Promise<Result>`
5. **Formatters/Validators Preserved**: Custom UI features remain intact

### Next Steps

Phase 2 is complete! Ready to proceed to:

**Phase 3: Message Handling Migration**

- Convert message handling to use AI SDK's native message types
- Update `AISDKClient.chat()` to use AI SDK messages directly
- Migrate from manual tool call parsing to AI SDK's built-in handling
- Remove conversion code in `ai-sdk-client.ts`

**Estimated effort**: 4-6 hours

See `.nanocoder/AI-SDK-MIGRATION-PROPOSAL.md` for full Phase 3 details.

## Files Changed

### Tool Files (10 files)

- `source/tools/read-file.tsx` - Migrated to AI SDK pattern
- `source/tools/create-file.tsx` - Migrated to AI SDK pattern
- `source/tools/insert-lines.tsx` - Migrated to AI SDK pattern
- `source/tools/replace-lines.tsx` - Migrated to AI SDK pattern
- `source/tools/delete-lines.tsx` - Migrated to AI SDK pattern
- `source/tools/read-many-files.tsx` - Migrated to AI SDK pattern
- `source/tools/execute-bash.tsx` - Migrated to AI SDK pattern
- `source/tools/web-search.tsx` - Migrated to AI SDK pattern
- `source/tools/fetch-url.tsx` - Migrated to AI SDK pattern
- `source/tools/search-files.tsx` - Migrated to AI SDK pattern

### Configuration Files (2 files)

- `source/types/core.ts` - Exported `tool` and `jsonSchema` helpers
- `knip.json` - Updated to ignore Phase 3-4 exports
- `.phase-3-tools.ts` - Created to document Phase 3-4 tool exports

## Testing

All tests pass:

- ✅ Format check
- ✅ Type check
- ✅ Lint check (7 pre-existing warnings in ai-sdk-client.ts)
- ✅ Unit tests (200 tests passed)
- ⚠️ Knip (10 unused exports - intentional for Phase 3-4)

## Phase 2 Complete Status

**Full Migration: 10/10 tools (100%) ✅**

All tools successfully migrated to AI SDK pattern while maintaining backward compatibility.
