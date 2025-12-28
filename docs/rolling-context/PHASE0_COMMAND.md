# Phase 0: `/rolling-context` Slash Command

## Overview

Add a toggle command to enable/disable rolling context management. **Default: OFF**.

This phase establishes the foundation for context management by:
- Adding configuration types
- Creating the toggle command
- Setting up the preference system

## 1. Add Configuration Types

**File:** `source/types/config.ts`

```typescript
// Context management configuration
export interface ContextManagementConfig {
  enabled: boolean;                 // Default: false (off)
  maxContextTokens?: number;        // Model's context limit (auto-detected if not set)
  reservedOutputTokens?: number;    // Tokens reserved for response (default: 4096)
  trimStrategy?: 'age-based' | 'priority-based';  // Default: 'priority-based'
  preserveRecentTurns?: number;     // Turns to always preserve (default: 5)
  summarizeOnTruncate?: boolean;    // Generate summaries (default: false)
  tokenEstimator?: 'auto' | 'conservative' | 'exact';  // Default: 'auto'
}

export interface UserPreferences {
  // ... existing fields
  rollingContextEnabled?: boolean;  // Quick toggle (default: false)
  contextManagement?: ContextManagementConfig;  // Full config
}

// Default configuration values
export const DEFAULT_CONTEXT_CONFIG: Required<ContextManagementConfig> = {
  enabled: false,
  maxContextTokens: 128000,
  reservedOutputTokens: 4096,
  trimStrategy: 'priority-based',
  preserveRecentTurns: 5,
  summarizeOnTruncate: false,
  tokenEstimator: 'auto',
};
```

## 2. Add Preference Helpers

**File:** `source/config/preferences.ts`

```typescript
import {
  DEFAULT_CONTEXT_CONFIG,
  type ContextManagementConfig
} from '@/types/config';

// Simple toggle for quick enable/disable
export function getRollingContextEnabled(): boolean {
  const preferences = loadPreferences();
  return preferences.rollingContextEnabled ?? false;
}

export function setRollingContextEnabled(enabled: boolean): void {
  const preferences = loadPreferences();
  preferences.rollingContextEnabled = enabled;
  savePreferences(preferences);
}

// Full configuration access
export function getContextManagementConfig(): Required<ContextManagementConfig> {
  const preferences = loadPreferences();
  const userConfig = preferences.contextManagement ?? {};

  return {
    ...DEFAULT_CONTEXT_CONFIG,
    ...userConfig,
    // Sync enabled state with quick toggle
    enabled: preferences.rollingContextEnabled ?? userConfig.enabled ?? false,
  };
}

export function setContextManagementConfig(
  config: Partial<ContextManagementConfig>
): void {
  const preferences = loadPreferences();
  preferences.contextManagement = {
    ...preferences.contextManagement,
    ...config,
  };
  savePreferences(preferences);
}

// Compute effective limits
export function getMaxInputTokens(): number {
  const config = getContextManagementConfig();
  return config.maxContextTokens - config.reservedOutputTokens;
}
```

## 3. Create Command

**File:** `source/commands/rolling-context.tsx`

```typescript
import {SuccessMessage} from '@/components/message-box';
import {
  getRollingContextEnabled,
  setRollingContextEnabled,
  getContextManagementConfig,
} from '@/config/preferences';
import type {Command} from '@/types/index';
import React from 'react';
import {Box, Text} from 'ink';

interface ToggleProps {
  enabled: boolean;
  config: ReturnType<typeof getContextManagementConfig>;
}

function RollingContextToggle({enabled, config}: ToggleProps) {
  return (
    <Box flexDirection="column">
      <SuccessMessage
        hideBox={true}
        message={`Rolling context ${enabled ? 'enabled' : 'disabled'}.`}
      />
      {enabled && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>
            Max context: {config.maxContextTokens.toLocaleString()} tokens
          </Text>
          <Text dimColor>
            Reserved for output: {config.reservedOutputTokens.toLocaleString()} tokens
          </Text>
          <Text dimColor>
            Max input: {(config.maxContextTokens - config.reservedOutputTokens).toLocaleString()} tokens
          </Text>
          <Text dimColor>
            Strategy: {config.trimStrategy}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export const rollingContextCommand: Command = {
  name: 'rolling-context',
  description: 'Toggle rolling context management (prevents context overflow)',
  handler: async (args: string[]) => {
    const arg = args[0]?.toLowerCase();
    let newState: boolean;

    if (arg === 'on' || arg === 'enable') {
      newState = true;
    } else if (arg === 'off' || arg === 'disable') {
      newState = false;
    } else if (arg === 'status') {
      // Show current status without changing
      const enabled = getRollingContextEnabled();
      const config = getContextManagementConfig();
      return React.createElement(RollingContextToggle, {
        key: `rolling-context-status-${Date.now()}`,
        enabled,
        config,
      });
    } else {
      // Toggle current state
      newState = !getRollingContextEnabled();
    }

    setRollingContextEnabled(newState);
    const config = getContextManagementConfig();

    return React.createElement(RollingContextToggle, {
      key: `rolling-context-${Date.now()}`,
      enabled: newState,
      config,
    });
  },
};
```

## 4. Export Command

**File:** `source/commands/index.ts`

```typescript
export * from '@/commands/rolling-context';
```

## 5. Register Command

**File:** `source/hooks/useAppInitialization.tsx`

```typescript
import {
  // ... existing imports
  rollingContextCommand,
} from '@/commands/index';

// In commandRegistry.register([...]):
commandRegistry.register([
  // ... existing commands
  rollingContextCommand,
]);
```

## 6. Add State (for runtime access)

**File:** `source/hooks/useAppState.tsx`

```typescript
import {
  getRollingContextEnabled,
  getContextManagementConfig,
  type ContextManagementConfig,
} from '@/config/preferences';

// Add to state
const [contextConfig, setContextConfig] = useState<Required<ContextManagementConfig>>(
  () => getContextManagementConfig()
);

// Reload config when preference changes
const reloadContextConfig = useCallback(() => {
  setContextConfig(getContextManagementConfig());
}, []);

// Export in return
return {
  // ... existing
  contextConfig,
  reloadContextConfig,
};
```

## Usage

```bash
/rolling-context          # Toggle on/off
/rolling-context on       # Enable
/rolling-context off      # Disable
/rolling-context status   # Show current configuration
```

## Status Integration

Add to `/status` output:

**File:** `source/commands/status.tsx`

```typescript
import {getRollingContextEnabled, getContextManagementConfig} from '@/config/preferences';

// In Status component render
const contextEnabled = getRollingContextEnabled();
const contextConfig = getContextManagementConfig();

// Add to status display
{contextEnabled && (
  <Box flexDirection="column">
    <Text color="green">Context Management: enabled</Text>
    <Text dimColor>
      Budget: {(contextConfig.maxContextTokens - contextConfig.reservedOutputTokens).toLocaleString()} input tokens
    </Text>
  </Box>
)}
```

## Config File Support

Users can configure defaults in `agents.config.json`:

```json
{
  "contextManagement": {
    "maxContextTokens": 128000,
    "reservedOutputTokens": 4096,
    "trimStrategy": "priority-based",
    "preserveRecentTurns": 5,
    "summarizeOnTruncate": false
  }
}
```

## Testing

**File:** `source/commands/rolling-context.spec.tsx`

```typescript
import test from 'ava';
import {rollingContextCommand} from './rolling-context';
import {getRollingContextEnabled, setRollingContextEnabled} from '@/config/preferences';

test.beforeEach(() => {
  // Reset to default state
  setRollingContextEnabled(false);
});

test('toggles rolling context on', async t => {
  await rollingContextCommand.handler(['on'], [], {} as any);
  t.true(getRollingContextEnabled());
});

test('toggles rolling context off', async t => {
  setRollingContextEnabled(true);
  await rollingContextCommand.handler(['off'], [], {} as any);
  t.false(getRollingContextEnabled());
});

test('toggles state when no argument', async t => {
  t.false(getRollingContextEnabled());
  await rollingContextCommand.handler([], [], {} as any);
  t.true(getRollingContextEnabled());
  await rollingContextCommand.handler([], [], {} as any);
  t.false(getRollingContextEnabled());
});

test('status shows current config without changing state', async t => {
  setRollingContextEnabled(true);
  await rollingContextCommand.handler(['status'], [], {} as any);
  t.true(getRollingContextEnabled()); // Should remain unchanged
});
```

## Next Steps

After completing Phase 0:
1. Verify command works: `/rolling-context on`, `/rolling-context status`
2. Check preference persistence across sessions
3. Proceed to Phase 1 (Token Budget Enforcement)
