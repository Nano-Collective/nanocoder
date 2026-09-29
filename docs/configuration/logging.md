---
title: "Logging"
description: "Structured logging configuration with Pino"
sidebar_order: 5
---

# Logging Configuration

Nanocoder includes structured logging with Pino, providing correlation tracking, basic timing and memory metrics, and automatic redaction of sensitive data.

## Quick Start

```bash
# Environment Variables
NANOCODER_LOG_LEVEL=debug            # Log level (trace, debug, info, warn, error, fatal, silent)
NANOCODER_LOG_DIR=/var/log/nanocoder # Log directory override
NANOCODER_LOG_DISABLE_FILE=true      # Turn file logging off entirely
```

## Features

- Structured JSON logging with metadata support
- Correlation tracking across components
- Automatic redaction of sensitive data
- Timing and memory metrics for provider requests and MCP operations

## Default Log File Locations

Logs are written to a daily file (`nanocoder-YYYY-MM-DD.log`) unless file logging is disabled. The default locations are platform-specific:

- **macOS**: `~/Library/Logs/nanocoder`
- **Linux/Unix**: `~/.local/state/nanocoder/logs` (or `$XDG_STATE_HOME/nanocoder/logs`)
- **Windows**: `%LOCALAPPDATA%/nanocoder/logs`

You can override the default location using the `NANOCODER_LOG_DIR` environment variable.

To disable file logging entirely, set `NANOCODER_LOG_DISABLE_FILE=true`. This takes precedence over `NANOCODER_LOG_LEVEL`: no log directory or file is created and nothing is written.

When Nanocoder runs under the Bun runtime, Pino's file transport is not loaded (it relies on worker threads Bun does not support), so a lightweight fallback logger is used and no log file is written.

## Configuration Examples

**Debugging an issue:**
```bash
NANOCODER_LOG_LEVEL=debug
```

**Custom log location:**
```bash
NANOCODER_LOG_LEVEL=info
NANOCODER_LOG_DIR=/var/log/nanocoder
```

**No log files:**
```bash
NANOCODER_LOG_DISABLE_FILE=true
```

## Environment Variables Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `NANOCODER_LOG_LEVEL` | Log level (trace, debug, info, warn, error, fatal, silent) | `info` |
| `NANOCODER_LOG_DIR` | Log directory override | Platform default |
| `NANOCODER_LOG_DISABLE_FILE` | Disable file logging entirely (overrides `NANOCODER_LOG_LEVEL`) | `false` |

## Key Capabilities

### Correlation Tracking

Unique correlation IDs are generated for request tracking across components. This enables cross-component request correlation with metadata support and async context preservation using `AsyncLocalStorage`.

### Security & Data Protection

Sensitive data is redacted automatically before it reaches the log file:

- Fields whose names look sensitive (for example `apiKey`, `token`, `password`, `secret`, `authorization`, `credentials`, `accessToken`, and anything containing `card` or `credit`)
- Values that look like API keys (long alphanumeric strings), Bearer tokens, email addresses, IPv4 addresses and UUIDs

Values that do not match these key names or patterns (for example phone numbers) are not redacted.

### Performance Metrics

Execution time and memory usage deltas are recorded for provider requests and MCP operations, and written alongside the related log entries.

## Usage Examples

### Basic Logging

```typescript
import {getLogger} from '@/utils/logging';

const logger = getLogger();

logger.fatal('Critical system failure');
logger.error('Operation failed', {error: new Error('Test error')});
logger.warn('Resource limit approaching');
logger.info('Application started successfully');
logger.debug('Debug information', {details: 'verbose'});
logger.trace('Detailed trace information');
```

### Structured Logging

```typescript
logger.info('User login successful', {
    userId: 'user-123',
    sessionId: 'session-456',
    authenticationMethod: 'oauth2',
    timestamp: new Date().toISOString()
});
```

### Correlation Context

```typescript
import {withNewCorrelationContext, getCorrelationId} from '@/utils/logging';

await withNewCorrelationContext(async (context) => {
    const correlationId = getCorrelationId();
    logger.info('Operation started', {correlationId});

    // All logs within this context share the same correlation ID
    logger.debug('Processing step 1');
    logger.debug('Processing step 2');
}, 'parent-correlation-id', {userId: 'user-123'});
```

## Troubleshooting

### Logs not appearing

- Check `NANOCODER_LOG_LEVEL` allows your messages through (e.g. `debug` level won't show with `info` level set)
- Verify the log directory exists and is writable
- Check `NANOCODER_LOG_DISABLE_FILE` is not set to `true`

### Performance degradation with logging

- Reduce the log level to `info` or `warn`
- Set `NANOCODER_LOG_DISABLE_FILE=true` if you do not need log files

### Sensitive data in logs

- The automatic redaction system handles the key names and patterns listed above
- Anything outside those patterns is written as-is, so avoid raising the log level to `debug` or `trace` when working with sensitive data you do not want on disk
