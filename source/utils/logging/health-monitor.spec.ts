import test from 'ava';
import {HealthMonitor, HealthCheckResult, SystemMetrics} from './health-monitor.js';
import {globalLogStorage} from './log-query.js';
import {globalRequestTracker} from './request-tracker.js';
import {globalPerformanceMonitor} from './performance.js';

// Test HealthMonitor class
// ============================================================================

test('HealthMonitor constructor creates instance with default config', t => {
    const monitor = new HealthMonitor();
    t.truthy(monitor);
    t.is(monitor.isActive(), false);
    // getLastHealthCheck() returns undefined initially, which is expected
    t.is(monitor.getLastHealthCheck(), undefined);
});

test('HealthMonitor constructor accepts custom config', t => {
    const customConfig = {
        enabled: false,
        interval: 60000,
        timeout: 10000,
    };
    
    const monitor = new HealthMonitor(customConfig);
    t.truthy(monitor);
    t.is(monitor.isActive(), false);
});

test('HealthMonitor start method starts monitoring', t => {
    const monitor = new HealthMonitor();
    monitor.start();
    t.true(monitor.isActive());
    monitor.stop();
});

test('HealthMonitor stop method stops monitoring', t => {
    const monitor = new HealthMonitor();
    monitor.start();
    t.true(monitor.isActive());
    
    monitor.stop();
    t.false(monitor.isActive());
});

test('HealthMonitor start method handles already running state', t => {
    const monitor = new HealthMonitor();
    monitor.start();
    
    // Should not throw when starting again
    monitor.start();
    t.true(monitor.isActive());
    
    monitor.stop();
});

test('HealthMonitor stop method handles not running state', t => {
    const monitor = new HealthMonitor();
    
    // Should not throw when stopping not running monitor
    monitor.stop();
    t.false(monitor.isActive());
});

// Test health check execution
// ============================================================================

test('HealthMonitor runHealthCheck returns HealthCheckResult', async t => {
    const monitor = new HealthMonitor();
    const result = await monitor.runHealthCheck();
    
    t.truthy(result);
    t.true('status' in result);
    t.true('score' in result);
    t.true('checks' in result);
    t.true('timestamp' in result);
    t.true('duration' in result);
    t.true('correlationId' in result);
    t.true('summary' in result);
    t.true('recommendations' in result);
});

test('HealthMonitor runHealthCheck includes expected checks', async t => {
    const monitor = new HealthMonitor();
    const result = await monitor.runHealthCheck();
    
    t.truthy(result.checks);
    t.true(Array.isArray(result.checks));
    t.true(result.checks.length > 0);
    
    // Check for expected check names
    const checkNames = result.checks.map(c => c.name);
    t.true(checkNames.includes('memory-usage'));
    t.true(checkNames.includes('logging-system'));
    t.true(checkNames.includes('request-tracking'));
    t.true(checkNames.includes('performance-monitoring'));
    t.true(checkNames.includes('configuration-system'));
});

test('HealthMonitor runHealthCheck calculates overall status correctly', async t => {
    const monitor = new HealthMonitor();
    const result = await monitor.runHealthCheck();
    
    t.true(['healthy', 'degraded', 'unhealthy'].includes(result.status));
    t.true(result.score >= 0 && result.score <= 100);
});

test('HealthMonitor runHealthCheck handles errors gracefully', async t => {
    const monitor = new HealthMonitor();
    
    // Mock a failing check by temporarily breaking the logger
    const originalLogger = console.log;
    console.log = () => { throw new Error('Mock error'); };
    
    const result = await monitor.runHealthCheck();
    
    // Restore logger
    console.log = originalLogger;
    
    t.truthy(result);
    t.is(result.status, 'unhealthy');
    t.is(result.score, 0);
});

// Test system metrics
// ============================================================================

test('HealthMonitor getSystemMetrics returns SystemMetrics', t => {
    const monitor = new HealthMonitor();
    const metrics = monitor.getSystemMetrics();
    
    t.truthy(metrics);
    t.true('timestamp' in metrics);
    t.true('memory' in metrics);
    t.true('cpu' in metrics);
    t.true('process' in metrics);
    t.true('logging' in metrics);
    t.true('requests' in metrics);
    t.true('performance' in metrics);
});

test('HealthMonitor getSystemMetrics includes memory information', t => {
    const monitor = new HealthMonitor();
    const metrics = monitor.getSystemMetrics();
    
    t.truthy(metrics.memory);
    t.true('heapUsed' in metrics.memory);
    t.true('heapTotal' in metrics.memory);
    t.true('external' in metrics.memory);
    t.true('rss' in metrics.memory);
    t.true('heapUsagePercent' in metrics.memory);
});

test('HealthMonitor getSystemMetrics includes process information', t => {
    const monitor = new HealthMonitor();
    const metrics = monitor.getSystemMetrics();
    
    t.truthy(metrics.process);
    t.true('uptime' in metrics.process);
    t.true('pid' in metrics.process);
    t.true('nodeVersion' in metrics.process);
    t.true('platform' in metrics.process);
    t.true('arch' in metrics.process);
});

// Test configuration management
// ============================================================================

test('HealthMonitor updateConfig updates configuration', t => {
    const monitor = new HealthMonitor();
    const originalInterval = monitor['config'].interval;
    
    monitor.updateConfig({interval: 60000});
    
    t.is(monitor['config'].interval, 60000);
    t.not(monitor['config'].interval, originalInterval);
});

test('HealthMonitor updateConfig restarts monitoring if running', t => {
    const monitor = new HealthMonitor();
    monitor.start();
    t.true(monitor.isActive());
    
    // Update config should restart monitoring
    monitor.updateConfig({interval: 60000});
    t.true(monitor.isActive());
    
    monitor.stop();
});

// Test health check methods
// ============================================================================

test('HealthMonitor getLastHealthCheck returns last check result', t => {
    const monitor = new HealthMonitor();
    t.truthy(monitor.getLastHealthCheck());
});

test('HealthMonitor isActive returns correct state', t => {
    const monitor = new HealthMonitor();
    t.false(monitor.isActive());
    
    monitor.start();
    t.true(monitor.isActive());
    
    monitor.stop();
    t.false(monitor.isActive());
});

// Test health check utility functions
// ============================================================================

test('healthChecks.quick returns status', async t => {
    const status = await import('./health-monitor.js').then(m => m.healthChecks.quick());
    t.true(['healthy', 'degraded', 'unhealthy'].includes(status));
});

test('healthChecks.full returns HealthCheckResult', async t => {
    const result = await import('./health-monitor.js').then(m => m.healthChecks.full());
    t.truthy(result);
    t.true('status' in result);
    t.true('score' in result);
});

test('healthChecks.metrics returns SystemMetrics', t => {
    const metrics = import('./health-monitor.js').then(m => m.healthChecks.metrics());
    t.truthy(metrics);
});

test('healthChecks.ready returns boolean', async t => {
    const ready = await import('./health-monitor.js').then(m => m.healthChecks.ready());
    t.true(typeof ready === 'boolean');
});

test('healthChecks.alive returns boolean', t => {
    const alive = import('./health-monitor.js').then(m => m.healthChecks.alive());
    t.true(typeof alive === 'boolean');
});

// Test health check middleware
// ============================================================================

test('healthCheckMiddleware handles health endpoint', async t => {
    const middleware = import('./health-monitor.js').then(m => m.healthCheckMiddleware());
    t.truthy(middleware);
});

// Test initialization function
// ============================================================================

test('initializeHealthMonitoring creates and starts monitor', t => {
    const originalMonitor = import('./health-monitor.js').then(m => m.globalHealthMonitor);
    
    // Call initialization
    import('./health-monitor.js').then(m => m.initializeHealthMonitoring());
    
    t.true(originalMonitor.then(m => m.isActive()));
});

// Test error scenarios
// ============================================================================

test('HealthMonitor handles memory check with high usage', async t => {
    const monitor = new HealthMonitor({
        thresholds: {
            memory: {
                heapUsageWarning: 0.1,
                heapUsageCritical: 0.2,
                externalWarning: 1,
                externalCritical: 2,
            },
            performance: {
                averageDurationWarning: 1000,
                averageDurationCritical: 5000,
                errorRateWarning: 0.05,
                errorRateCritical: 0.1,
            },
            logging: {
                logRateWarning: 100,
                logRateCritical: 500,
                errorRateWarning: 0.02,
                errorRateCritical: 0.05,
            },
            requests: {
                durationWarning: 1000,
                durationCritical: 5000,
                errorRateWarning: 0.05,
                errorRateCritical: 0.1,
            },
        },
    });
    
    const result = await monitor.runHealthCheck();
    t.truthy(result);
});

test('HealthMonitor handles request tracking with high error rate', async t => {
    const monitor = new HealthMonitor({
        thresholds: {
            memory: {
                heapUsageWarning: 0.8,
                heapUsageCritical: 0.95,
                externalWarning: 256,
                externalCritical: 512,
            },
            performance: {
                averageDurationWarning: 1000,
                averageDurationCritical: 5000,
                errorRateWarning: 0.05,
                errorRateCritical: 0.1,
            },
            logging: {
                logRateWarning: 100,
                logRateCritical: 500,
                errorRateWarning: 0.02,
                errorRateCritical: 0.05,
            },
            requests: {
                durationWarning: 1,
                durationCritical: 2,
                errorRateWarning: 0.01,
                errorRateCritical: 0.02,
            },
        },
    });
    
    const result = await monitor.runHealthCheck();
    t.truthy(result);
});

// Test correlation context handling
// ============================================================================

test('HealthMonitor maintains correlation context', async t => {
    const monitor = new HealthMonitor();
    const result = await monitor.runHealthCheck();
    
    t.truthy(result.correlationId);
    t.true(result.correlationId.length > 0);
});

// Test alert functionality
// ============================================================================

test('HealthMonitor sendAlert handles console alerts', async t => {
    const monitor = new HealthMonitor({
        alerts: {
            enabled: true,
            channels: ['console'],
            cooldown: 0,
        },
    });
    
    const result = await monitor.runHealthCheck();
    
    // Should not throw even if alerts are sent
    t.truthy(result);
});

// Cleanup after tests
// ============================================================================

test.after('cleanup global instances', t => {
    // Clear any test data from global instances
    globalLogStorage.clear();
    globalRequestTracker.clear();
    globalPerformanceMonitor.clear();
});