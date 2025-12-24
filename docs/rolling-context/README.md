# Rolling Context Feature

Intelligent context management to prevent unbounded growth from tool outputs.

## Quick Start

1. **Phase 0** - Add `/rolling-context` command (`PHASE0_COMMAND.md`) **<-- Start here**
2. **Phase 1** - Implement core truncation (`PHASE1_TRUNCATION.md`)
3. **Phase 2** - Add file-aware retrieval (`PHASE2_FILE_RETRIEVAL.md`)
4. **Phase 3** - Optional summarization (`PHASE3_SUMMARIZATION.md`)

See `IMPLEMENTATION_PLAN.md` for full architecture overview.

## Key Files to Create/Modify

```
# Phase 0 - Command
source/commands/rolling-context.tsx  # NEW - Toggle command
source/types/config.ts               # MODIFY - Add preference type
source/config/preferences.ts         # MODIFY - Add getter/setter
source/hooks/useAppInitialization.tsx # MODIFY - Register command

# Phase 1+ - Core Logic
source/utils/context-manager.ts      # NEW - Core truncation
source/utils/file-tracker.ts         # NEW - File reference tracking
source/utils/context-summarizer.ts   # NEW - Summarization (Phase 3)
source/hooks/chat-handler/use-chat-handler.tsx  # MODIFY - Integration
```

## Default Behavior

**OFF by default.** Enable with `/rolling-context` command.

When enabled:
- Truncate tool outputs older than **5 steps**
- Preserve files modified in current session
- Keep error messages intact
- Replace truncated content with metadata stubs

## Usage

```bash
/rolling-context        # Toggle on/off
/rolling-context on     # Enable
/rolling-context off    # Disable
```
