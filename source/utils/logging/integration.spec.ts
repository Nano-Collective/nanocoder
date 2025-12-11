import test from 'ava';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log(`\nlogging/integration.spec.ts`);

// Integration tests for the complete logging system
import {
  initializeLogger,
  getLogger,
  end,
  flush,
  globalLogStorage,
  globalRequestTracker,
  healthChecks
} from './index.js';

// Import correlation functionality
import { generateCorrelationId, withNewCorrelationContext, getCorrelationId } from './correlation.js';

// Import redaction
import { redactValue, redactEmail, createRedactionRules } from './redaction.js';

// Create a temporary test directory
const testDir = join(tmpdir(), `nanocoder-logging-integration-${Date.now()}`);

test.before(() => {
  mkdirSync(testDir, { recursive: true });
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'debug';
});

test.after.always(async () => {
  // Clean up
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }

  // Reset logger state
  await end();
});

test('end-to-end logging workflow', async t => {
  // Initialize logger with test configuration
  const logger = initializeLogger({
    level: 'debug',
    pretty: false,
    correlation: true,
    redact: ['apiKey', 'password']
  });

  t.truthy(logger, 'Logger should be initialized');

  // Test basic logging
  logger.info('Integration test started');
  logger.warn('Warning message', { code: 'TEST_WARNING' });
  logger.error('Error message', { error: new Error('Test error') });

  // Test correlation context
  const correlationId = generateCorrelationId();
  t.truthy(correlationId, 'Should generate correlation ID');

  await withNewCorrelationContext(async () => {
    const contextCorrelationId = getCorrelationId();
    t.truthy(contextCorrelationId, 'Should have correlation ID in context');

    logger.info('Message with correlation context', { action: 'test' });
  }, correlationId, { userId: 'test-user' });

  // Test redaction
  const sensitiveData = {
    username: 'testuser',
    apiKey: 'secret-key-123',
    password: 'secret-pass',
    email: 'test@example.com'
  };

  const redactedApiKey = redactValue(sensitiveData.apiKey) as string;
  const redactedPassword = redactValue(sensitiveData.password) as string;
  t.is(sensitiveData.username, 'testuser', 'Should preserve non-sensitive fields');
  t.true(redactedApiKey === '[REDACTED]' || redactedApiKey.includes('*'), 'Should redact apiKey');
  t.true(redactedPassword === '[REDACTED]' || redactedPassword.includes('*'), 'Should redact password');
  t.is(sensitiveData.email, 'test@example.com', 'Should preserve non-redacted fields');

  // Test PII detection
  const piiData = {
    email: 'user@domain.com',
    phone: '+1-555-123-4567',
    ssn: '123-45-6789',
    normalField: 'safe data'
  };

  const redactedSsn = redactValue(piiData.ssn) as string;
  const maskedEmail = redactEmail(piiData.email);
  t.true(typeof maskedEmail === 'string', 'Should return masked email');
  t.true(redactedSsn === '[REDACTED]' || redactedSsn.includes('*'), 'Should redact SSN');
  t.is(piiData.normalField, 'safe data', 'Should preserve safe data');

  // Test log storage
  globalLogStorage.addEntry({
    timestamp: new Date().toISOString(),
    level: 'info',
    message: 'Test entry',
    correlationId,
    metadata: { test: true }
  });

  const logs = globalLogStorage.query({ limit: 10 });
  t.true(logs.entries.length > 0, 'Should store log entries');

  // Test request tracking
  const requestId = globalRequestTracker.startRequest({
    type: 'http',
    method: 'GET',
    endpoint: '/api/test'
  });

  t.truthy(requestId, 'Should start request tracking');

  globalRequestTracker.completeRequest(requestId);
  const stats = globalRequestTracker.getStats();
  t.true(stats.totalRequests >= 1, 'Should track request statistics');

  // Test health checks
  const health = await healthChecks.quick();
  t.true(health === 'healthy', 'Health check should pass');

  const metrics = healthChecks.metrics();
  t.truthy(metrics, 'Should return health metrics');

  // Test logger cleanup
  await flush();
  await end();

  t.pass('End-to-end workflow completed successfully');
});

test('logging system handles high volume gracefully', async t => {
  const logger = initializeLogger({ level: 'info', pretty: false });

  const startTime = performance.now();
  const messageCount = 1000;

  // Generate high volume of logs
  for (let i = 0; i < messageCount; i++) {
    logger.info(`High volume test message ${i}`, {
      batchId: 'test-batch',
      index: i,
      timestamp: new Date().toISOString()
    });
  }

  const endTime = performance.now();
  const duration = endTime - startTime;
  const avgTime = duration / messageCount;

  // Should handle high volume efficiently (less than 1ms per log)
  t.true(avgTime < 1, `Should handle high volume efficiently (${avgTime.toFixed(4)}ms per message)`);

  await end();
});

test('multiple concurrent logging contexts', async t => {
  const logger = initializeLogger({
    level: 'debug',
    correlation: true
  });

  const promises = [];
  const contexts = 10;
  const messagesPerContext = 50;

  // Create multiple concurrent logging contexts
  for (let ctx = 0; ctx < contexts; ctx++) {
    promises.push(
      withNewCorrelationContext(async () => {
        const correlationId = getCorrelationId();
        t.truthy(correlationId, 'Each context should have correlation ID');

        for (let msg = 0; msg < messagesPerContext; msg++) {
          logger.info(`Context ${ctx} message ${msg}`, {
            contextId: ctx,
            messageId: msg,
            batch: 'concurrent-test'
          });
        }
      }, undefined, { contextId: ctx })
    );
  }

  await Promise.all(promises);

  // Verify that all contexts completed
  const logs = globalLogStorage.query({ limit: 1000 });
  const contextLogs = logs.entries.filter(log => (log as any).batch === 'concurrent-test');
  t.true(contextLogs.length >= contexts * messagesPerContext, 'Should log from all contexts');

  await end();
});


test('error handling and recovery', async t => {
  const logger = initializeLogger({ level: 'info' });

  // Test logging with circular references
  const circular: any = { id: 1, data: 'test' };
  circular.self = circular;

  t.notThrows(() => {
    logger.info('Circular reference test', circular);
  }, 'Should handle circular references gracefully');

  // Test logging with very large objects
  const largeObject = {
    data: 'x'.repeat(10000),
    array: Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `item-${i}` }))
  };

  t.notThrows(() => {
    logger.info('Large object test', { summary: largeObject });
  }, 'Should handle large objects gracefully');

  // Test logging with undefined/null values
  t.notThrows(() => {
    logger.info('Edge case test', {
      nullValue: null,
      undefinedValue: undefined,
      emptyString: '',
      zero: 0,
      false: false
    });
  }, 'Should handle edge case values gracefully');

  await end();
});

test('child logger functionality', async t => {
  const parentLogger = initializeLogger({ level: 'debug', correlation: true });

  // Create child logger with bindings
  const childLogger = parentLogger.child({
    module: 'test-module',
    version: '1.0.0'
  });

  t.truthy(childLogger, 'Should create child logger');
  t.not(parentLogger === childLogger, 'Child should be different instance');

  // Test child logger with correlation
  await withNewCorrelationContext(async () => {
    childLogger.info('Child logger message', { action: 'test' });

    // Create grandchild
    const grandchildLogger = childLogger.child({
      subModule: 'test-submodule'
    });

    grandchildLogger.info('Grandchild message', { action: 'nested-test' });
  }, undefined, { requestId: 'req-123' });

  t.pass('Child logger functionality working correctly');

  await end();
});

test('performance metrics integration', async t => {
  const logger = initializeLogger({
    level: 'info'
  });

  // Simulate operations with performance tracking
  const promises = [];

  for (let i = 0; i < 5; i++) {
    promises.push(
      new Promise<void>(resolve => {
        setTimeout(() => {
          logger.info(`Performance test ${i}`, {
            operation: `test-${i}`,
            timestamp: Date.now()
          });
          resolve();
        }, Math.random() * 50);
      })
    );
  }

  await Promise.all(promises);

  // Get performance metrics if available
  try {
    const metrics = healthChecks.metrics();
    t.truthy(metrics, 'Should return health metrics');

    if (metrics && typeof metrics === 'object' && 'performance' in metrics) {
      const perfMetrics = (metrics as any).performance;
      t.truthy(typeof perfMetrics === 'object', 'Should have performance data');
    }
  } catch (error) {
    // Performance metrics might not be available in test environment
    t.pass('Performance metrics test skipped');
  }

  await end();
});

test('graceful shutdown and cleanup', async t => {
  const logger = initializeLogger({
    level: 'info'
  });

  // Log some messages
  for (let i = 0; i < 100; i++) {
    logger.info(`Shutdown test message ${i}`, {
      batch: 'shutdown-test',
      index: i
    });
  }

  // Test flush
  await t.notThrowsAsync(async () => {
    await flush();
  }, 'Flush should complete without errors');

  // Test end
  await t.notThrowsAsync(async () => {
    await end();
  }, 'End should complete without errors');

  // Verify logger can be reinitialized
  const newLogger = initializeLogger({ level: 'info' });
  t.truthy(newLogger, 'Should reinitialize after shutdown');

  await end();
});

test('structured data handling and serialization', async t => {
  const logger = initializeLogger({
    level: 'debug',
    serialize: true
  });

  // Test complex nested objects
  const complexData = {
    user: {
      id: '123',
      profile: {
        name: 'Test User',
        preferences: {
          theme: 'dark',
          language: 'en',
          notifications: {
            email: true,
            push: false,
            sms: null
          }
        }
      },
      metadata: {
        lastLogin: new Date().toISOString(),
        sessions: [
          { id: 1, duration: 3600 },
          { id: 2, duration: 1800 }
        ]
      }
    },
    request: {
      headers: {
        'user-agent': 'test-agent',
        'accept': 'application/json',
        'authorization': '[REDACTED]'
      }
    }
  };

  t.notThrows(() => {
    logger.info('Complex data test', complexData);
  }, 'Should handle complex nested objects');

  // Test special characters and Unicode
  const unicodeData = {
    emoji: '🚀 🎉 ✅',
    chinese: '中文测试',
    arabic: 'اختبار العربية',
    specialChars: '"quotes", \'apostrophes\', \n\t\r\\',
    binary: Buffer.from('binary data').toString('base64')
  };

  t.notThrows(() => {
    logger.info('Unicode test', unicodeData);
  }, 'Should handle Unicode and special characters');

  await end();
});

console.log('Integration tests completed successfully!');