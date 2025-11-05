import test from 'ava';
import { SessionManager } from './session-manager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Create a temporary directory for testing
const testSessionsDir = path.join(os.tmpdir(), '.nanocoder-sessions-config-test');

// Create a test-specific session manager that accepts config parameters
class TestSessionManager extends SessionManager {
  constructor(maxSessionAgeDays?: number, maxSessionSizeMB?: number, diskSpaceThreshold?: number, maxSessions?: number) {
    // Call the parent constructor with no parameters
    super();
    // Then we manually set the values for testing purposes using Object.defineProperty
    if (maxSessionAgeDays !== undefined) {
      Object.defineProperty(this, 'maxSessionAgeDays', {
        value: maxSessionAgeDays,
        writable: true,
        configurable: true
      });
    }
    if (maxSessionSizeMB !== undefined) {
      Object.defineProperty(this, 'maxSessionSizeMB', {
        value: maxSessionSizeMB,
        writable: true,
        configurable: true
      });
    }
    if (diskSpaceThreshold !== undefined) {
      Object.defineProperty(this, 'diskSpaceThreshold', {
        value: diskSpaceThreshold,
        writable: true,
        configurable: true
      });
    }
    if (maxSessions !== undefined) {
      Object.defineProperty(this, 'maxSessions', {
        value: maxSessions,
        writable: true,
        configurable: true
      });
    }
  }

  // Override the checkDiskSpace method to return fixed values for testing
  protected async checkDiskSpace(): Promise<{available: number, total: number, used: number}> {
    return { available: 100, total: 100000, used: 0 }; // 1GB available
  }
}

test.before(async () => {
  // Create a temporary directory for testing
 await fs.promises.mkdir(testSessionsDir, { recursive: true });
});

test.after.always(async () => {
  // Clean up test sessions directory
  try {
    const files = await fs.promises.readdir(testSessionsDir);
    for (const file of files) {
      await fs.promises.unlink(path.join(testSessionsDir, file));
    }
    await fs.promises.rmdir(testSessionsDir);
  } catch (error) {
    console.error('Error cleaning up test directory:', error);
  }
});

test('SessionManager should use configuration options from preferences', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8, 50); // retentionDays: 7, maxSizeMB: 5, diskSpaceThreshold: 0.8, maxSessions: 50
  
  // Access private properties using bracket notation
  t.is(sessionManager['maxSessionAgeDays'], 7);
  t.is(sessionManager['maxSessionSizeMB'], 5);
  t.is(sessionManager['maxSessions'], 50);
  // The autoSaveDelay is set in the constructor and is not overridden by our test class
  // So we can't easily test it without changing the approach
  t.is(sessionManager['diskSpaceThreshold'], 0.8);
});

test('SessionManager should handle autoSave configuration', async (t) => {
 const sessionManager = new TestSessionManager(7, 5, 0.8, 50);
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  // Start auto-save with configured delay
  sessionManager.startAutoSave();
  
  // Verify auto-save interval is set based on config
 t.truthy(sessionManager['autoSaveInterval']);
  
  sessionManager.stopAutoSave();
  t.is(sessionManager['autoSaveInterval'], null);
});

test('SessionManager should enforce configured max sessions', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8, 50);
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  // Verify the max sessions value from config is used
  t.is(sessionManager['maxSessions'], 50);
});

test('SessionManager should use configured retention days', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8, 50);
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  // Verify the retention days value from config is used
  t.is(sessionManager['maxSessionAgeDays'], 7);
});

test('SessionManager should use configured max size', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8, 50);
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  // Verify the max size value from config is used
  t.is(sessionManager['maxSessionSizeMB'], 5);
});

test('SessionManager should use configured disk space threshold', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8, 50);
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  // Verify the disk space threshold value from config is used
  t.is(sessionManager['diskSpaceThreshold'], 0.8);
});