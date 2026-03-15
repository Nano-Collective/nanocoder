---
title: "Logging"
description: "Structured logging configuration with Pino"
sidebar_order: 5
---

# Logging Configuration

Nanocoder includes comprehensive structured logging with Pino, providing enterprise-grade logging capabilities including correlation tracking, performance monitoring, and security features.

## Quick Start

```bash
# Environment Variables
NANOCODER_LOG_LEVEL=debug          # Log level (trace, debug, info, warn, error, fatal)
NANOCODER_LOG_TO_FILE=true         # Enable file logging
NANOCODER_LOG_TO_CONSOLE=true      # Enable console logging
NANOCODER_LOG_DIR=/var/log/nanocoder # Log directory
NANOCODER_CORRELATION_ENABLED=true  # Enable correlation tracking
```

## Features

- Structured JSON logging with metadata support
- Correlation tracking across components
- Automatic PII detection and redaction
- Performance monitoring and metrics
- Production-ready file rotation and compression

## Default Log File Locations

When `NANOCODER_LOG_TO_FILE=true` is set, logs are stored in platform-specific locations:

- **macOS**: `~/Library/Preferences/nanocoder/logs`
- **Linux/Unix**: `~/.config/nanocoder/logs/nanocoder/`
- **Windows**: `%APPDATA%\nanocoder\logs\`

You can override the default location using `NANOCODER_LOG_DIR` environment variable.

## Configuration Examples

**Development:**
```bash
NANOCODER_LOG_LEVEL=debug
NANOCODER_LOG_TO_FILE=false
NANOCODER_LOG_TO_CONSOLE=true
NANOCODER_CORRELATION_ENABLED=true
NANOCODER_CORRELATION_DEBUG=true
```

**Production:**
```bash
NANOCODER_LOG_LEVEL=info
NANOCODER_LOG_TO_FILE=true
NANOCODER_LOG_TO_CONSOLE=false
NANOCODER_LOG_DIR=/var/log/nanocoder
NANOCODER_CORRELATION_ENABLED=true
NANOCODER_CORRELATION_DEBUG=false
```

## Environment Variables Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `NANOCODER_LOG_LEVEL` | Log level (trace, debug, info, warn, error, fatal) | `info` |
| `NANOCODER_LOG_TO_FILE` | Enable file logging | `false` |
| `NANOCODER_LOG_TO_CONSOLE` | Enable console logging | `true` |
| `NANOCODER_LOG_DIR` | Log directory override | Platform default |
| `NANOCODER_LOG_TRANSPORTS` | Transport configuration | `default` |
| `NANOCODER_CORRELATION_DEBUG` | Debug correlation tracking | `false` |
| `NANOCODER_CORRELATION_ENABLED` | Enable correlation tracking | `true` |
| `NANOCODER_CORRELATION_LEGACY_FALLBACK` | Disable legacy fallback | `false` |

## Key Capabilities

### Correlation Tracking

Unique correlation IDs are generated for request tracking across components. This enables cross-component request correlation with metadata support and async context preservation.

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

### Logs not appearing in console

- Check that `NANOCODER_LOG_TO_CONSOLE` is set to `true`
- Verify the log level allows your messages through

### Performance degradation with logging

- Reduce log level in production to `info` or `warn`
- Disable correlation tracking for high-volume operations

### Sensitive data in logs

- The automatic redaction system handles common patterns
- Add custom redaction rules for application-specific fields

For the complete API reference, advanced features, and detailed troubleshooting, see the full [Pino Logging Implementation Guide](https://github.com/Nano-Collective/nanocoder/blob/main/docs/pino-logging.md) in the repository.
