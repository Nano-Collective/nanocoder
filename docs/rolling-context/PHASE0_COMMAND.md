# Phase 0: `/rolling-context` Slash Command

## Overview

Add a toggle command to enable/disable rolling context management. **Default: OFF**.

## 1. Add Preference Type

**File:** `source/types/config.ts`

```typescript
export interface UserPreferences {
  // ... existing fields
  rollingContextEnabled?: boolean;  // Default: false (off)
}
```

## 2. Add Preference Helpers

**File:** `source/config/preferences.ts`

```typescript
export function getRollingContextEnabled(): boolean {
  const preferences = loadPreferences();
  return preferences.rollingContextEnabled ?? false;  // Default OFF
}

export function setRollingContextEnabled(enabled: boolean): void {
  const preferences = loadPreferences();
  preferences.rollingContextEnabled = enabled;
  savePreferences(preferences);
}
```

## 3. Create Command

**File:** `source/commands/rolling-context.tsx`

```typescript
import {SuccessMessage} from '@/components/message-box';
import {
  getRollingContextEnabled,
  setRollingContextEnabled,
} from '@/config/preferences';
import type {Command} from '@/types/index';
import React from 'react';

function RollingContextToggle({enabled}: {enabled: boolean}) {
  return (
    <SuccessMessage
      hideBox={true}
      message={`Rolling context ${enabled ? 'enabled' : 'disabled'}.${
        enabled
          ? ' Tool outputs older than 5 steps will be truncated.'
          : ''
      }`}
    />
  );
}

export const rollingContextCommand: Command = {
  name: 'rolling-context',
  description: 'Toggle rolling context management (truncates old tool outputs)',
  handler: async (args: string[]) => {
    // Check for explicit on/off argument
    const arg = args[0]?.toLowerCase();
    let newState: boolean;

    if (arg === 'on' || arg === 'enable') {
      newState = true;
    } else if (arg === 'off' || arg === 'disable') {
      newState = false;
    } else {
      // Toggle current state
      newState = !getRollingContextEnabled();
    }

    setRollingContextEnabled(newState);

    return React.createElement(RollingContextToggle, {
      key: `rolling-context-${Date.now()}`,
      enabled: newState,
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
// Add to state
const [rollingContextEnabled, setRollingContextEnabled] = useState<boolean>(false);

// Load from preferences on init
useEffect(() => {
  const enabled = getRollingContextEnabled();
  setRollingContextEnabled(enabled);
}, []);

// Export in return
return {
  // ... existing
  rollingContextEnabled,
  setRollingContextEnabled,
};
```

## Usage

```bash
/rolling-context        # Toggle on/off
/rolling-context on     # Enable
/rolling-context off    # Disable
```

## Status Integration (Optional)

Add to `/status` output:

```typescript
// In Status component
{rollingContextEnabled && (
  <Text color="green">Rolling Context: enabled</Text>
)}
```

## Testing

```typescript
// source/commands/rolling-context.spec.tsx

import test from 'ava';
import {rollingContextCommand} from './rolling-context';

test('toggles rolling context on', async t => {
  const result = await rollingContextCommand.handler(['on'], [], {...});
  // Verify preference was set
});

test('toggles rolling context off', async t => {
  const result = await rollingContextCommand.handler(['off'], [], {...});
  // Verify preference was cleared
});

test('toggles state when no argument', async t => {
  // Start with off, should become on
});
```
