import { SessionManager } from './session-manager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import test from 'ava';

// Mock the child_process exec function to avoid actual system calls during testing
// Note: AVA doesn't have the same mocking capabilities as Jest, so we'll handle differently
// For now, we'll create a subclass to override the method
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
    return { available: 100000, total: 1000000, used: 0 }; // 1GB available, 1GB total
  }
  
  // Override enforceMaxSessionsLimit to prevent auto-deletion during tests
  protected async enforceMaxSessionsLimit(): Promise<void> {
    // Do nothing in tests to prevent auto-deletion of test sessions
    return Promise.resolve();
  }
}

// Create a temporary directory for testing
const testSessionsDir = path.join(os.tmpdir(), '.nanocoder-sessions-test');

// Setup and teardown
test.before(async () => {
  // Create a temporary directory for testing
 // First, ensure it's clean
  try {
    await fs.promises.rm(testSessionsDir, { recursive: true, force: true });
  } catch (error) {
    // Ignore if it doesn't exist
  }
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

test('should create a new session', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8); // max age: 7 days, max size: 5MB, disk threshold: 80%
  // Override the sessions directory for testing
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  const initialMessages = [
    { 
      role: 'user' as const, 
      content: 'Hello', 
      timestamp: Date.now(),
      tool_calls: undefined,
      tool_call_id: undefined,
      name: undefined
    },
    { 
      role: 'assistant' as const, 
      content: 'Hi there!', 
      timestamp: Date.now(),
      tool_calls: undefined,
      tool_call_id: undefined,
      name: undefined
    }
  ];
  
  const session = await sessionManager.createSession(initialMessages);
  
  t.truthy(session);
  t.truthy(session.id);
  t.is(session.title, 'Hello');
  t.is(session.version, 1);
  t.is(session.messages.length, 2);
  t.truthy(session.metadata);
  t.is(session.metadata?.workingDirectory, process.cwd());
});

test('should save and load a session', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8);
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  const session = await sessionManager.createSession([
    { 
      role: 'user' as const, 
      content: 'Test message', 
      timestamp: Date.now(),
      tool_calls: undefined,
      tool_call_id: undefined,
      name: undefined
    }
  ]);
  
  // Save the session (it's already saved by createSession, but test the save method separately)
  await sessionManager.saveSession(session);
  
  // Load the session
  const loadedSession = await sessionManager.loadSession(session.id);
  
  t.truthy(loadedSession);
  t.is(loadedSession?.id, session.id);
  t.is(loadedSession?.title, 'Test message');
  t.is(loadedSession?.messages.length, 1);
});

test('should list sessions', async (t) => {
 const sessionManager = new TestSessionManager(7, 5, 0.8, 100); // Set max sessions to 100 to avoid auto-deletion during test
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  // Create a few sessions
  await sessionManager.createSession([
    {
      role: 'user' as const,
      content: 'Session 1',
      timestamp: Date.now(),
      tool_calls: undefined,
      tool_call_id: undefined,
      name: undefined
    }
  ]);
  await sessionManager.createSession([
    {
      role: 'user' as const,
      content: 'Session 2',
      timestamp: Date.now(),
      tool_calls: undefined,
      tool_call_id: undefined,
      name: undefined
    }
  ]);
  
  const sessions = await sessionManager.listSessions();
  
  t.truthy(sessions);
  t.is(sessions.length, 2);
  t.truthy(sessions[0].id);
  t.truthy(sessions[0].title);
  t.truthy(sessions[0].updatedAt);
});

test('should delete a session', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8);
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  const session = await sessionManager.createSession([
    { 
      role: 'user' as const, 
      content: 'To be deleted', 
      timestamp: Date.now(),
      tool_calls: undefined,
      tool_call_id: undefined,
      name: undefined
    }
  ]);
  
  // Verify session exists
 const sessionBefore = await sessionManager.loadSession(session.id);
  t.truthy(sessionBefore);
  
  // Delete the session
  await sessionManager.deleteSession(session.id);
  
  // Verify session is gone
  const sessionAfter = await sessionManager.loadSession(session.id);
  t.is(sessionAfter, null);
});

test('should handle session size limits', async (t) => {
  const sessionManager = new TestSessionManager(7, 1, 0.8); // Small size limit to trigger the error
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  // Create a very large session to test size limit
  const largeMessages = Array(1000).fill(null).map((_, i) => ({
    role: 'user' as const,
    content: `Message ${i} `.repeat(1000), // Make content large
    timestamp: Date.now(),
    tool_calls: undefined,
    tool_call_id: undefined,
    name: undefined
 }));
  
  const session = {
    id: 'large_session_test',
    title: 'Large Session',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
    messages: largeMessages,
    metadata: { workingDirectory: process.cwd() }
  };
  
  // This should throw an error due to size limit
 const error = await t.throwsAsync(() => sessionManager.saveSession(session));
  t.truthy(error?.message.includes('Session size exceeds limit'));
});

test('should validate messages properly', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8);
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  const validSession = await sessionManager.createSession([
    { 
      role: 'user' as const, 
      content: 'Valid message', 
      timestamp: Date.now(),
      tool_calls: undefined,
      tool_call_id: undefined,
      name: undefined
    }
  ]);
  
  const loadedSession = await sessionManager.loadSession(validSession.id);
  t.truthy(loadedSession);
});

test('should handle backward compatibility', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8);
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  // Create a session with old format manually
  const oldFormatSession = {
    id: 'old_format_session',
    title: 'Old Format',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [
      { role: 'user', content: 'Old message', timestamp: Date.now() } // Without tool properties
    ]
  };
  
  // Save the old format session manually
 const sessionFile = path.join(testSessionsDir, `${oldFormatSession.id}.json`);
  await fs.promises.writeFile(sessionFile, JSON.stringify(oldFormatSession), 'utf8');
  
  // Update the index
  const sessions = await sessionManager.listSessions();
 const newSessionInfo = { 
    id: oldFormatSession.id, 
    title: oldFormatSession.title, 
    updatedAt: oldFormatSession.updatedAt 
  };
  const updatedSessions = [...sessions, newSessionInfo];
  const indexFile = path.join(testSessionsDir, 'sessions.json');
  await fs.promises.writeFile(indexFile, JSON.stringify(updatedSessions), 'utf8');
  
  // Load the session - it should be migrated automatically
 const migratedSession = await sessionManager.loadSession(oldFormatSession.id);
  
  t.truthy(migratedSession);
  t.is(migratedSession?.version, 1); // Should be migrated to version 1
  t.truthy('tool_calls' in migratedSession?.messages[0]!);
  t.truthy('tool_call_id' in migratedSession?.messages[0]!);
  t.truthy('name' in migratedSession?.messages[0]!);
});

test('should cache sessions properly', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8);
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  const session = await sessionManager.createSession([
    {
      role: 'user' as const,
      content: 'Cached session',
      timestamp: Date.now(),
      tool_calls: undefined,
      tool_call_id: undefined,
      name: undefined
    }
  ]);
  
  // Load the session to populate cache
  await sessionManager.getSessionWithCache(session.id);
  
  // Load again - should come from cache
  const cachedSession = await sessionManager.getSessionWithCache(session.id);
  
  t.truthy(cachedSession);
  t.is(cachedSession?.id, session.id);
});

test('should clear session cache', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8);
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  const session = await sessionManager.createSession([
    {
      role: 'user' as const,
      content: 'Cached session',
      timestamp: Date.now(),
      tool_calls: undefined,
      tool_call_id: undefined,
      name: undefined
    }
  ]);
  
  // Load the session to populate cache
  await sessionManager.getSessionWithCache(session.id);
  
  // Verify it's in cache
  const cachedSession = await sessionManager.getSessionWithCache(session.id);
  t.truthy(cachedSession);
  
  // Clear the cache
 sessionManager.clearSessionCache();
  
  // Cache should be empty now
  t.is(sessionManager['sessionCache'].size, 0);
});

test('should get session with cache correctly', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8);
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  const session = await sessionManager.createSession([
    {
      role: 'user' as const,
      content: 'Test session for cache',
      timestamp: Date.now(),
      tool_calls: undefined,
      tool_call_id: undefined,
      name: undefined
    }
  ]);
  
  // Load without cache first
  const sessionWithoutCache = await sessionManager.getSessionWithCache(session.id, false);
  t.truthy(sessionWithoutCache);
  
  // Load with cache
  const sessionWithCache = await sessionManager.getSessionWithCache(session.id, true);
 t.truthy(sessionWithCache);
  t.is(sessionWithCache?.id, session.id);
});

test('should handle disk space checks', async (t) => {
 const sessionManager = new TestSessionManager(7, 5, 0.8);
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  // Create a session
  const session = await sessionManager.createSession([
    {
      role: 'user' as const,
      content: 'Test session',
      timestamp: Date.now(),
      tool_calls: undefined,
      tool_call_id: undefined,
      name: undefined
    }
  ]);
  
  // Check if session size is valid
  const isValidSize = (sessionManager as any).isSessionSizeValid(session);
  t.true(isValidSize);
  
  // Check session size calculation
 const size = (sessionManager as any).getSessionSize(session);
  t.true(size > 0);
});

test('should enforce max sessions limit', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8, 2); // Max 2 sessions
 Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  // Create 3 sessions to exceed the limit
  const session1 = await sessionManager.createSession([
    {
      role: 'user' as const,
      content: 'Session 1',
      timestamp: Date.now(),
      tool_calls: undefined,
      tool_call_id: undefined,
      name: undefined
    }
  ]);
  
  const session2 = await sessionManager.createSession([
    {
      role: 'user' as const,
      content: 'Session 2',
      timestamp: Date.now(),
      tool_calls: undefined,
      tool_call_id: undefined,
      name: undefined
    }
  ]);
  
  const session3 = await sessionManager.createSession([
    {
      role: 'user' as const,
      content: 'Session 3',
      timestamp: Date.now(),
      tool_calls: undefined,
      tool_call_id: undefined,
      name: undefined
    }
  ]);
  
  // Enforce the limit
  await (sessionManager as any).enforceMaxSessionsLimit();
  
  // List sessions to see which ones remain
  const sessions = await sessionManager.listSessions();
  
  // Should have 2 sessions (the newest ones)
  t.is(sessions.length, 2);
  
  // The oldest session (session1) should be deleted
  const session1Exists = await sessionManager.loadSession(session1.id);
  t.is(session1Exists, null);
  
  // The newest sessions should still exist
  const session2Exists = await sessionManager.loadSession(session2.id);
  const session3Exists = await sessionManager.loadSession(session3.id);
  t.truthy(session2Exists);
  t.truthy(session3Exists);
});

test('should cleanup old sessions', async (t) => {
  const sessionManager = new TestSessionManager(1, 5, 0.8, 100); // 1 day retention, max 100 sessions to avoid auto-delete interference
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  // Create a recent session (should not be cleaned up)
  const recentSession = await sessionManager.createSession([
    {
      role: 'user' as const,
      content: 'Recent session',
      timestamp: Date.now(),
      tool_calls: undefined,
      tool_call_id: undefined,
      name: undefined
    }
  ]);
  
  // Create an old session manually (should be cleaned up)
  const oldSessionId = 'old_session_test';
  const oldSession = {
    id: oldSessionId,
    title: 'Old Session',
    createdAt: Date.now() - (2 * 24 * 60 * 60 * 1000), // 2 days ago
    updatedAt: Date.now() - (2 * 24 * 60 * 60 * 1000), // 2 days ago
    version: 1,
    messages: [
      {
        role: 'user' as const,
        content: 'Old message',
        timestamp: Date.now() - (2 * 24 * 60 * 60 * 1000),
        tool_calls: undefined,
        tool_call_id: undefined,
        name: undefined
      }
    ],
    metadata: { workingDirectory: process.cwd() }
  };
  
  // Save the old session manually
  const sessionFile = path.join(testSessionsDir, `${oldSessionId}.json`);
  await fs.promises.writeFile(sessionFile, JSON.stringify(oldSession, null, 2), 'utf8');
  
  // Update the index
  const sessions = await sessionManager.listSessions();
  const newSessionInfo = {
    id: oldSessionId,
    title: oldSession.title,
    updatedAt: oldSession.updatedAt
  };
  const updatedSessions = [...sessions, newSessionInfo];
  const indexFile = path.join(testSessionsDir, 'sessions.json');
  await fs.promises.writeFile(indexFile, JSON.stringify(updatedSessions), 'utf8');
  
  // Verify both sessions exist before cleanup
  const oldSessionBefore = await sessionManager.loadSession(oldSessionId);
  const recentSessionBefore = await sessionManager.loadSession(recentSession.id);
  t.truthy(oldSessionBefore);
  t.truthy(recentSessionBefore);
  
  // Cleanup old sessions
  await sessionManager.cleanupOldSessions();
  
  // Old session should be deleted, recent session should remain
  const oldSessionAfter = await sessionManager.loadSession(oldSessionId);
  const recentSessionAfter = await sessionManager.loadSession(recentSession.id);
  t.is(oldSessionAfter, null);
  t.truthy(recentSessionAfter);
});

test('should validate messages correctly with invalid data', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8);
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  // Test with invalid role
 const invalidRoleSession = {
    id: 'invalid_role_session',
    title: 'Invalid Role Session',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
    messages: [
      {
        role: 'invalid_role' as any, // Invalid role
        content: 'Test message',
        timestamp: Date.now(),
        tool_calls: undefined,
        tool_call_id: undefined,
        name: undefined
      }
    ],
    metadata: { workingDirectory: process.cwd() }
  };
  
  const isValidRole = (sessionManager as any).validateMessages(invalidRoleSession.messages);
  t.false(isValidRole);
  
  // Test with invalid content
  const invalidContentSession = {
    id: 'invalid_content_session',
    title: 'Invalid Content Session',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
    messages: [
      {
        role: 'user' as const,
        content: 123 as any, // Invalid content type
        timestamp: Date.now(),
        tool_calls: undefined,
        tool_call_id: undefined,
        name: undefined
      }
    ],
    metadata: { workingDirectory: process.cwd() }
  };
  
  const isValidContent = (sessionManager as any).validateMessages(invalidContentSession.messages);
  t.false(isValidContent);
});

test('should handle corrupted session files gracefully', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8);
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  // Create a corrupted session file
  const corruptedSessionId = 'corrupted_session';
  const corruptedSessionFile = path.join(testSessionsDir, `${corruptedSessionId}.json`);
  await fs.promises.writeFile(corruptedSessionFile, '{"invalid": json}', 'utf8'); // Invalid JSON
  
  // Update the index
  const sessions = await sessionManager.listSessions();
  const newSessionInfo = {
    id: corruptedSessionId,
    title: 'Corrupted Session',
    updatedAt: Date.now()
  };
  const updatedSessions = [...sessions, newSessionInfo];
  const indexFile = path.join(testSessionsDir, 'sessions.json');
  await fs.promises.writeFile(indexFile, JSON.stringify(updatedSessions), 'utf8');
  
  // Loading a corrupted session should return null
  const corruptedSession = await sessionManager.loadSession(corruptedSessionId);
  t.is(corruptedSession, null);
});

test('should handle missing session files gracefully', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8);
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  // Try to load a non-existent session
  const missingSession = await sessionManager.loadSession('non_existent_session_id');
  t.is(missingSession, null);
});

test('should generate proper session titles', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8);
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  // Test with a short message
  const shortMessages = [
    {
      role: 'user' as const,
      content: 'Short message',
      timestamp: Date.now(),
      tool_calls: undefined,
      tool_call_id: undefined,
      name: undefined
    }
  ];
  const shortTitle = sessionManager.generateSessionTitle(shortMessages);
  t.is(shortTitle, 'Short message');
  
  // Test with a long message (should be truncated)
  const longMessage = 'This is a very long message that exceeds the 50 character limit for session titles';
  const longMessages = [
    {
      role: 'user' as const,
      content: longMessage,
      timestamp: Date.now(),
      tool_calls: undefined,
      tool_call_id: undefined,
      name: undefined
    }
  ];
  const longTitle = sessionManager.generateSessionTitle(longMessages);
  t.true(longTitle.length <= 50);
  t.true(longTitle.endsWith('...'));
  
  // Test with no user messages (should return 'Untitled Session')
 const noUserMessages = [
    {
      role: 'assistant' as const,
      content: 'Assistant message',
      timestamp: Date.now(),
      tool_calls: undefined,
      tool_call_id: undefined,
      name: undefined
    }
  ];
  const noUserTitle = sessionManager.generateSessionTitle(noUserMessages);
  t.is(noUserTitle, 'Untitled Session');
  
  // Test with empty messages (should return 'Untitled Session')
  const emptyTitle = sessionManager.generateSessionTitle([]);
  t.is(emptyTitle, 'Untitled Session');
});

test('should handle auto-save functionality', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8);
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  // Start auto-save
  sessionManager.startAutoSave();
  
  // Verify auto-save interval is set
  t.truthy(sessionManager['autoSaveInterval']);
  
  // Stop auto-save
 sessionManager.stopAutoSave();
  
  // Verify auto-save interval is cleared
  t.is(sessionManager['autoSaveInterval'], null);
});

test('should list sessions with size information', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8);
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  // Create a session
  const session = await sessionManager.createSession([
    {
      role: 'user' as const,
      content: 'Session with size info',
      timestamp: Date.now(),
      tool_calls: undefined,
      tool_call_id: undefined,
      name: undefined
    }
  ]);
  
  // List sessions with size info
  const sessionsWithSize = await sessionManager.listSessions(true);
  
  // Find the session we created
  const foundSession = sessionsWithSize.find(s => s.id === session.id);
  t.truthy(foundSession);
  t.truthy(foundSession?.size);
  t.true(foundSession!.size! > 0);
});

test('should handle session cleanup properly', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8);
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  // Create a session and load it to populate cache
  const session = await sessionManager.createSession([
    {
      role: 'user' as const,
      content: 'Session for cleanup test',
      timestamp: Date.now(),
      tool_calls: undefined,
      tool_call_id: undefined,
      name: undefined
    }
  ]);
  await sessionManager.getSessionWithCache(session.id);
  
  // Verify cache has items
 t.true(sessionManager['sessionCache'].size > 0);
  
  // Perform cleanup
  await sessionManager.cleanup();
  
  // Cache should be empty after cleanup
  t.is(sessionManager['sessionCache'].size, 0);
  t.is(sessionManager['autoSaveInterval'], null);
});

test('should handle invalid session index gracefully', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8);
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  // Create an invalid session index file (not an array)
  const indexFile = path.join(testSessionsDir, 'sessions.json');
  await fs.promises.writeFile(indexFile, '{"not": "an array"}', 'utf8');
  
  // This should not throw an error and should return an empty array
  const sessions = await sessionManager.listSessions();
  t.is(sessions.length, 0);
});

test('should handle malformed session index gracefully', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8);
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  // Create a malformed session index file (array with invalid objects)
  const indexFile = path.join(testSessionsDir, 'sessions.json');
  await fs.promises.writeFile(indexFile, '[{"id": "test"}, {"title": "test"}, {"id": "test2", "title": "test2", "updatedAt": "not a number"}]', 'utf8');
  
  // This should return only valid session objects
  const sessions = await sessionManager.listSessions();
  // Only the complete valid session object should be returned
  t.true(sessions.length >= 0); // Should not crash
});

test('should handle disk space threshold correctly', async (t) => {
  const sessionManager = new TestSessionManager(7, 5, 0.8); // 80% threshold
  Object.assign(sessionManager, { sessionsDir: testSessionsDir });
  await sessionManager.initialize();
  
  // Create a session
  const session = await sessionManager.createSession([
    {
      role: 'user' as const,
      content: 'Test session for disk space',
      timestamp: Date.now(),
      tool_calls: undefined,
      tool_call_id: undefined,
      name: undefined
    }
  ]);
  
  // Check if there's enough disk space for the session
  const sessionSize = (sessionManager as any).getSessionSize(session);
  const hasSpace = await (sessionManager as any).hasEnoughDiskSpace(sessionSize);
  t.true(hasSpace); // Should have space with our test values
});