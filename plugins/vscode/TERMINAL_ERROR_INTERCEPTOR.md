# Terminal Error Interceptor Feature

## Overview

The Terminal Error Interceptor is a VS Code extension feature that automatically detects errors in the integrated terminal and provides a quick "Fix with AI" action to send them directly to Nanocoder for diagnosis and fixing.

## Features

### Automatic Error Detection

The extension monitors terminal output for common error patterns including:

- **TypeScript/JavaScript errors**: `error TS2304`, `SyntaxError`, `TypeError`, `ReferenceError`
- **Build tool errors**: `ERROR in`, `Build failed`, `[ERROR]`
- **Test failures**: `FAIL`, `failing`, `Test suite failed`
- **Linting errors**: ESLint errors, lint problems
- **Generic errors**: `Error:`, `Exception:`, `ENOENT:`, `command not found`

### User Interaction

When an error is detected in the terminal:

1. A notification appears: "Terminal error detected. Would you like Nanocoder to help fix it?"
2. User can click **"Fix with AI"** to automatically:
   - Extract the error context (last 30 relevant lines)
   - Send it to the Nanocoder chat panel
   - Focus the chat panel for immediate AI assistance
3. Or click **"Dismiss"** to ignore the error

### Manual Trigger

Users can also manually trigger the fix action via the Command Palette:

1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
2. Type "Fix Terminal Error with AI"
3. Paste or describe the error
4. The error is sent to Nanocoder for analysis

## Usage

### Automatic Mode

Simply run commands in the VS Code integrated terminal. When an error occurs:

```bash
$ npm run build
ERROR in ./src/index.ts
Module not found: Error: Can't resolve './config'
```

The extension will automatically detect this and offer to help fix it.

### Manual Mode

For older errors or custom scenarios:

1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Select "Nanocoder: Fix Terminal Error with AI"
3. Paste the error text
4. Nanocoder will analyze and suggest fixes

## Implementation Details

### Components

- **terminal-error-interceptor.ts**: Core implementation
  - Monitors terminal output via `onDidWriteTerminalData` API (VS Code 1.93+)
  - Maintains a 100-line rolling buffer per terminal
  - Detects errors using regex patterns
  - Extracts relevant error context

- **extension.ts**: Integration point
  - Initializes the interceptor on extension activation
  - Connects it to the chat webview provider
  - Registers the manual fix command

### Error Context Extraction

The interceptor intelligently extracts error context by:

1. Working backwards from the error
2. Including stack traces (`at ...`)
3. Including source code lines with numbers (`10 |`)
4. Including build output markers (`→`, `✖`)
5. Capping at 30 lines to avoid overwhelming the AI

### Compatibility

- **VS Code 1.125+**: Required minimum version (set in `engines.vscode`)
- **VS Code 1.93+**: Full automatic detection via `onDidWriteTerminalData` API
- **VS Code 1.125-1.92**: Manual trigger only via command palette

The extension gracefully detects API availability and falls back to manual mode on older versions within the supported range.

## Configuration

No additional configuration is required. The feature works out of the box once the extension is installed.

## Testing

Tests are located in `terminal-error-interceptor.spec.ts` and cover:

- Error pattern detection for various error types
- Error context extraction logic
- Integration with the extension lifecycle

Run tests:

```bash
pnpm run test:ava plugins/vscode/src/terminal-error-interceptor.spec.ts
```

## Future Enhancements

Potential improvements:

- Configurable error patterns via settings
- Auto-apply suggested fixes for simple errors
- Learn from user corrections to improve detection
- Support for custom error patterns per project
- Integration with VS Code's Problems panel
