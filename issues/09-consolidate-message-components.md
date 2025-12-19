# Consolidate message components into single MessageBox

## Priority: High

## Description

Four nearly identical message components exist with ~50 lines each, differing only in color and title. Additionally, memoization is inconsistent (error/warning are memoized, success/info are not).

## Affected Files

- `source/components/error-message.tsx` (50 lines)
- `source/components/success-message.tsx` (50 lines)
- `source/components/warning-message.tsx` (50 lines)
- `source/components/info-message.tsx` (50 lines)

## Proposed Solution

Create a single `MessageBox` component:

```typescript
// source/components/message-box.tsx
import { memo } from 'react';
import { Box, Text } from 'ink';
import { useThemeColors } from '@/hooks/useTheme';
import { TitledBox } from './ui/titled-box';

type MessageType = 'error' | 'success' | 'warning' | 'info';

interface MessageBoxProps {
    type: MessageType;
    title?: string;
    children: React.ReactNode;
}

const defaultTitles: Record<MessageType, string> = {
    error: 'Error',
    success: 'Success',
    warning: 'Warning',
    info: 'Info',
};

export const MessageBox = memo(function MessageBox({
    type,
    title,
    children
}: MessageBoxProps) {
    const colors = useThemeColors();
    const colorMap: Record<MessageType, string> = {
        error: colors.error,
        success: colors.success,
        warning: colors.warning,
        info: colors.info,
    };

    return (
        <TitledBox
            title={title || defaultTitles[type]}
            borderColor={colorMap[type]}
        >
            {children}
        </TitledBox>
    );
});

// Convenience exports for backward compatibility
export const ErrorMessage = (props: Omit<MessageBoxProps, 'type'>) =>
    <MessageBox type="error" {...props} />;
export const SuccessMessage = (props: Omit<MessageBoxProps, 'type'>) =>
    <MessageBox type="success" {...props} />;
export const WarningMessage = (props: Omit<MessageBoxProps, 'type'>) =>
    <MessageBox type="warning" {...props} />;
export const InfoMessage = (props: Omit<MessageBoxProps, 'type'>) =>
    <MessageBox type="info" {...props} />;
```

## Acceptance Criteria

- [ ] Single `MessageBox` component with `type` prop
- [ ] Consistent memoization across all message types
- [ ] Backward-compatible exports for existing usage
- [ ] ~150 lines of code removed
- [ ] All existing tests pass
- [ ] Old component files deleted
