---
title: "Logging"
description: "Structured logging configuration with Pino"
sidebar_order: 5
---

# Logging Configuration

Nanocoder includes structured logging with Pino, providing correlation tracking, performance monitoring, and automatic PII redaction.

## Quick Start

```bash
# Environment Variables
NANOCODER_LOG_LEVEL=debug          # Log level (trace, debug, info, warn, error, fatal)
NANOCODER_LOG_DIR=/var/log/nanocoder # Log directory override
NANOCODER_CORRELATION_ENABLED=true  # Enable correlation tracking
```

## Features

- Structured JSON logging with metadata support
- Correlation tracking across components
- Automatic PII detection and redaction
- Performance monitoring and metrics

## Default Log File Locations

Logs are always written to file. The default locations are platform-specific:

- **macOS**: `~/Library/Logs/nanocoder`
- **Linux/Unix**: `~/.local/state/nanocoder/logs` (or `$XDG_STATE_HOME/nanocoder/logs`)
- **Windows**: `%LOCALAPPDATA%/nanocoder/logs`

You can override the default location using the `NANOCODER_LOG_DIR` environment variable.

To disable file logging entirely, set `NANOCODER_LOG_DISABLE_FILE=true`.

## Configuration Examples

**Development:**
```bash
NANOCODER_LOG_LEVEL=debug
NANOCODER_CORRELATION_ENABLED=true
NANOCODER_CORRELATION_DEBUG=true
```

**Production:**
```bash
NANOCODER_LOG_LEVEL=info
NANOCODER_LOG_DIR=/var/log/nanocoder
NANOCODER_CORRELATION_ENABLED=true
NANOCODER_CORRELATION_DEBUG=false
```

## Environment Variables Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `NANOCODER_LOG_LEVEL` | Log level (trace, debug, info, warn, error, fatal) | `info` |
| `NANOCODER_LOG_TO_FILE` | Enable file logging | `true` |
| `NANOCODER_LOG_DIR` | Log directory override | Platform default |
| `NANOCODER_LOG_DISABLE_FILE` | Disable file logging entirely | `false` |
| `NANOCODER_CORRELATION_DEBUG` | Debug correlation tracking | `false` |
| `NANOCODER_CORRELATION_ENABLED` | Enable correlation tracking | `true` |

## Key Capabilities

### Correlation Tracking

Unique correlation IDs are generated for request tracking across components. This enables cross-component request correlation with metadata support and async context preservation using `AsyncLocalStorage`.

### Security & Data Protection

Automatic detection and redaction of sensitive data including emails, phone numbers, SSNs, credit cards, API keys, passwords, and tokens.

### Performance Monitoring

Function execution time tracking, memory usage monitoring, CPU usage tracking, and configurable performance threshold alerts.

### Request Tracking

HTTP request timing, AI provider call tracking, MCP server operation monitoring, and error rate monitoring.

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

- Reduce log level in production to `info` or `warn`
- Disable correlation tracking for high-volume operations

### Sensitive data in logs

- The automatic redaction system handles common patterns
- Add custom redaction rules for application-specific fields
