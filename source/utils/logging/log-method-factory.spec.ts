import test from 'ava';
import {createLogMethod, createLogMethods} from './log-method-factory.js';

// Mock logger for testing
class MockLogger {
    private logs: Array<{level: string; args: unknown[]}> = [];
    
    fatal(...args: unknown[]) {
        this.logs.push({level: 'fatal', args});
    }
    
    error(...args: unknown[]) {
        this.logs.push({level: 'error', args});
    }
    
    warn(...args: unknown[]) {
        this.logs.push({level: 'warn', args});
    }
    
    info(...args: unknown[]) {
        this.logs.push({level: 'info', args});
    }
    
    http(...args: unknown[]) {
        this.logs.push({level: 'http', args});
    }
    
    debug(...args: unknown[]) {
        this.logs.push({level: 'debug', args});
    }
    
    trace(...args: unknown[]) {
        this.logs.push({level: 'trace', args});
    }
    
    getLogs() {
        return this.logs;
    }
    
    clear() {
        this.logs = [];
    }
}

// Test createLogMethod function
// ============================================================================

test('createLogMethod creates function that logs messages', t => {
    const mockLogger = new MockLogger();
    const logMethod = createLogMethod(mockLogger, 'info');
    
    t.truthy(logMethod);
    t.is(typeof logMethod, 'function');
});

test('createLogMethod handles string-first signature', t => {
    const mockLogger = new MockLogger();
    const logMethod = createLogMethod(mockLogger, 'info');
    
    logMethod('test message', {key: 'value'});
    
    const logs = mockLogger.getLogs();
    t.is(logs.length, 1);
    t.is(logs[0].level, 'info');
});

test('createLogMethod handles object-first signature', t => {
    const mockLogger = new MockLogger();
    const logMethod = createLogMethod(mockLogger, 'info');
    
    logMethod({key: 'value'}, 'test message');
    
    const logs = mockLogger.getLogs();
    t.is(logs.length, 1);
    t.is(logs[0].level, 'info');
});

test('createLogMethod with contextPrefix adds prefix to messages', t => {
    const mockLogger = new MockLogger();
    const logMethod = createLogMethod(mockLogger, 'info', {contextPrefix: 'TEST'});
    
    logMethod('test message');
    
    const logs = mockLogger.getLogs();
    t.is(logs.length, 1);
    t.true(String(logs[0].args[0]).includes('[TEST]'));
});

test('createLogMethod with consolePrefix handles console logger', t => {
    const originalConsole = console.info;
    let consoleCalled = false;
    console.info = (...args: unknown[]) => {
        consoleCalled = true;
        originalConsole(...args);
    };
    
    const logMethod = createLogMethod(console, 'info', {consolePrefix: 'TEST'});
    
    logMethod('test message');
    
    t.true(consoleCalled);
    
    // Restore console
    console.info = originalConsole;
});

test('createLogMethod with transformArgs transforms arguments', t => {
    const mockLogger = new MockLogger();
    const transformArgs = (args: unknown[]) => [args[0], 'transformed'];
    
    const logMethod = createLogMethod(mockLogger, 'info', {transformArgs});
    
    logMethod('test message', 'original');
    
    const logs = mockLogger.getLogs();
    t.is(logs.length, 1);
    t.true(logs[0].args.includes('transformed'));
});

test('createLogMethod with transformResult transforms result', t => {
    const mockLogger = new MockLogger();
    let transformCalled = false;
    const transformResult = () => { transformCalled = true; };
    
    const logMethod = createLogMethod(mockLogger, 'info', {transformResult});
    
    logMethod('test message');
    
    t.true(transformCalled);
});

test('createLogMethod handles logger without level method gracefully', t => {
    const mockLogger = {info: undefined};
    const logMethod = createLogMethod(mockLogger, 'info');
    
    // Should not throw
    logMethod('test message');
    t.pass();
});

test('createLogMethod handles logger method errors with fallback', t => {
    const mockLogger = {
        info: () => { throw new Error('Mock error'); }
    };
    
    const originalConsole = console.log;
    let consoleCalled = false;
    console.log = (...args: unknown[]) => {
        consoleCalled = true;
        originalConsole(...args);
    };
    
    const logMethod = createLogMethod(mockLogger, 'info');
    
    // Should fallback to console
    logMethod('test message');
    
    t.true(consoleCalled);
    
    // Restore console
    console.info = originalConsole;
});

// Test createLogMethods function
// ============================================================================

test('createLogMethods creates all standard log methods', t => {
    const mockLogger = new MockLogger();
    const logMethods = createLogMethods(mockLogger);
    
    t.truthy(logMethods);
    t.is(typeof logMethods.fatal, 'function');
    t.is(typeof logMethods.error, 'function');
    t.is(typeof logMethods.warn, 'function');
    t.is(typeof logMethods.info, 'function');
    t.is(typeof logMethods.http, 'function');
    t.is(typeof logMethods.debug, 'function');
    t.is(typeof logMethods.trace, 'function');
});

test('createLogMethods with contextPrefix adds prefix to all methods', t => {
    const mockLogger = new MockLogger();
    const logMethods = createLogMethods(mockLogger, {contextPrefix: 'TEST'});
    
    logMethods.info('info message');
    logMethods.error('error message');
    logMethods.warn('warn message');
    
    const logs = mockLogger.getLogs();
    t.is(logs.length, 3);
    t.true(String(logs[0].args[0]).includes('[TEST]'));
    t.true(String(logs[1].args[0]).includes('[TEST]'));
    t.true(String(logs[2].args[0]).includes('[TEST]'));
});

test('createLogMethods with transformArgs transforms arguments for all methods', t => {
    const mockLogger = new MockLogger();
    const transformArgs = (args: unknown[], level?: string) => [level, ...args];
    
    const logMethods = createLogMethods(mockLogger, {transformArgs});
    
    logMethods.info('info message');
    logMethods.error('error message');
    
    const logs = mockLogger.getLogs();
    t.is(logs.length, 2);
    t.true(logs[0].args.includes('info'));
    t.true(logs[1].args.includes('error'));
});

test('createLogMethods with transformResult transforms result for all methods', t => {
    const mockLogger = new MockLogger();
    let transformCount = 0;
    const transformResult = () => { transformCount++; };
    
    const logMethods = createLogMethods(mockLogger, {transformResult});
    
    logMethods.info('info message');
    logMethods.error('error message');
    logMethods.warn('warn message');
    
    t.is(transformCount, 3);
});

test('createLogMethods handles console logger with consolePrefix', t => {
    const originalConsole = console.info;
    let consoleInfoCalled = false;
    console.info = (...args: unknown[]) => {
        consoleInfoCalled = true;
        originalConsole(...args);
    };
    
    const logMethods = createLogMethods(console, {consolePrefix: 'TEST'});
    
    logMethods.info('test message');
    
    t.true(consoleInfoCalled);
    
    // Restore console
    console.info = originalConsole;
});

// Test different log levels
// ============================================================================

test('createLogMethod creates fatal level method', t => {
    const mockLogger = new MockLogger();
    const logMethod = createLogMethod(mockLogger, 'fatal');
    
    logMethod('fatal message');
    
    const logs = mockLogger.getLogs();
    t.is(logs.length, 1);
    t.is(logs[0].level, 'fatal');
});

test('createLogMethod creates error level method', t => {
    const mockLogger = new MockLogger();
    const logMethod = createLogMethod(mockLogger, 'error');
    
    logMethod('error message');
    
    const logs = mockLogger.getLogs();
    t.is(logs.length, 1);
    t.is(logs[0].level, 'error');
});

test('createLogMethod creates warn level method', t => {
    const mockLogger = new MockLogger();
    const logMethod = createLogMethod(mockLogger, 'warn');
    
    logMethod('warn message');
    
    const logs = mockLogger.getLogs();
    t.is(logs.length, 1);
    t.is(logs[0].level, 'warn');
});

test('createLogMethod creates debug level method', t => {
    const mockLogger = new MockLogger();
    const logMethod = createLogMethod(mockLogger, 'debug');
    
    logMethod('debug message');
    
    const logs = mockLogger.getLogs();
    t.is(logs.length, 1);
    t.is(logs[0].level, 'debug');
});

test('createLogMethod creates trace level method', t => {
    const mockLogger = new MockLogger();
    const logMethod = createLogMethod(mockLogger, 'trace');
    
    logMethod('trace message');
    
    const logs = mockLogger.getLogs();
    t.is(logs.length, 1);
    t.is(logs[0].level, 'trace');
});

test('createLogMethod creates http level method', t => {
    const mockLogger = new MockLogger();
    const logMethod = createLogMethod(mockLogger, 'http');
    
    logMethod('http message');
    
    const logs = mockLogger.getLogs();
    t.is(logs.length, 1);
    t.is(logs[0].level, 'http');
});

// Test edge cases
// ============================================================================

test('createLogMethod handles empty message', t => {
    const mockLogger = new MockLogger();
    const logMethod = createLogMethod(mockLogger, 'info');
    
    // Should not throw
    logMethod('');
    t.pass();
});

test('createLogMethod handles null object', t => {
    const mockLogger = new MockLogger();
    const logMethod = createLogMethod(mockLogger, 'info');
    
    // Should not throw
    logMethod(null as any, 'message');
    t.pass();
});

test('createLogMethod handles undefined arguments', t => {
    const mockLogger = new MockLogger();
    const logMethod = createLogMethod(mockLogger, 'info');
    
    // Should not throw
    logMethod('message', undefined);
    t.pass();
});

test('createLogMethod handles complex objects', t => {
    const mockLogger = new MockLogger();
    const logMethod = createLogMethod(mockLogger, 'info');
    
    const complexObj = {
        nested: {
            deep: {
                value: 'test'
            }
        },
        array: [1, 2, 3],
        func: () => 'test'
    };
    
    // Should not throw
    logMethod(complexObj, 'complex object');
    t.pass();
});

// Test console fallback for trace level
// ============================================================================

test('createLogMethod falls back to console.log for trace level', t => {
    const mockLogger = {
        trace: () => { throw new Error('Trace not supported'); }
    };
    
    const originalConsole = console.log;
    let consoleCalled = false;
    console.log = (...args: unknown[]) => {
        consoleCalled = true;
        originalConsole(...args);
    };
    
    const logMethod = createLogMethod(mockLogger, 'trace');
    
    logMethod('trace message');
    
    t.true(consoleCalled);
    
    // Restore console
    console.log = originalConsole;
});

// Test method signature compatibility
// ============================================================================

test('createLogMethod supports both string-first and object-first signatures', t => {
    const mockLogger = new MockLogger();
    const logMethod = createLogMethod(mockLogger, 'info');
    
    // String-first signature
    logMethod('message', {key: 'value'});
    
    // Object-first signature  
    logMethod({key: 'value'}, 'message');
    
    const logs = mockLogger.getLogs();
    t.is(logs.length, 2);
});

// Test error handling in transform functions
// ============================================================================

test('createLogMethod handles errors in transformArgs gracefully', t => {
    const mockLogger = new MockLogger();
    const transformArgs = () => { throw new Error('Transform error'); };
    
    const logMethod = createLogMethod(mockLogger, 'info', {transformArgs});
    
    // Should not throw
    logMethod('test message');
    t.pass();
});

test('createLogMethod handles errors in transformResult gracefully', t => {
    const mockLogger = new MockLogger();
    const transformResult = () => { throw new Error('Transform error'); };
    
    const logMethod = createLogMethod(mockLogger, 'info', {transformResult});
    
    // Should not throw
    logMethod('test message');
    t.pass();
});

// Test console method mapping
// ============================================================================

test('createLogMethod maps trace level to console.log', t => {
    const originalConsole = console.log;
    let consoleCalled = false;
    console.log = (...args: unknown[]) => {
        consoleCalled = true;
        originalConsole(...args);
    };
    
    const logMethod = createLogMethod(console, 'trace', {consolePrefix: 'TEST'});
    
    logMethod('trace message');
    
    t.true(consoleCalled);
    
    // Restore console
    console.log = originalConsole;
});

test('createLogMethod maps info level to console.info', t => {
    const originalConsole = console.info;
    let consoleCalled = false;
    console.info = (...args: unknown[]) => {
        consoleCalled = true;
        originalConsole(...args);
    };
    
    const logMethod = createLogMethod(console, 'info', {consolePrefix: 'TEST'});
    
    logMethod('info message');
    
    t.true(consoleCalled);
    
    // Restore console
    console.info = originalConsole;
});

test('createLogMethod maps error level to console.error', t => {
    const originalConsole = console.error;
    let consoleCalled = false;
    console.error = (...args: unknown[]) => {
        consoleCalled = true;
        originalConsole(...args);
    };
    
    const logMethod = createLogMethod(console, 'error', {consolePrefix: 'TEST'});
    
    logMethod('error message');
    
    t.true(consoleCalled);
    
    // Restore console
    console.error = originalConsole;
});

// Test multiple arguments handling
// ============================================================================

test('createLogMethod handles multiple arguments', t => {
    const mockLogger = new MockLogger();
    const logMethod = createLogMethod(mockLogger, 'info');
    
    logMethod('message', 'arg1', 'arg2', {key: 'value'});
    
    const logs = mockLogger.getLogs();
    t.is(logs.length, 1);
    t.is(logs[0].args.length, 4); // message + 3 args
});

test('createLogMethod handles object-first with multiple arguments', t => {
    const mockLogger = new MockLogger();
    const logMethod = createLogMethod(mockLogger, 'info');
    
    logMethod('message', {key: 'value'}, 'arg1', 'arg2');
    
    const logs = mockLogger.getLogs();
    t.is(logs.length, 1);
});

// Test type safety
// ============================================================================

test('createLogMethod returns function with correct type signature', t => {
    const mockLogger = new MockLogger();
    const logMethod = createLogMethod(mockLogger, 'info');
    
    // Should accept string-first signature
    logMethod('message');
    logMethod('message', {key: 'value'});
    
    // Should accept object-first signature
    logMethod({key: 'value'});
    logMethod({key: 'value'}, 'message');
    
    t.pass();
});

// Test console method override
// ============================================================================

test('createLogMethod uses specified consoleMethod', t => {
    const originalConsole = console.warn;
    let consoleCalled = false;
    console.warn = (...args: unknown[]) => {
        consoleCalled = true;
        originalConsole(...args);
    };
    
    const logMethod = createLogMethod(console, 'info', {
        consolePrefix: 'TEST',
        consoleMethod: 'warn'
    });
    
    logMethod('info message');
    
    t.true(consoleCalled);
    
    // Restore console
    console.warn = originalConsole;
});

// Cleanup
// ============================================================================

test.after('cleanup mock logger', t => {
    // Any cleanup if needed
});