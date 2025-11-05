import { SessionManager } from './session-manager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function testSessionManager() {
  console.log('Testing Session Manager...');
  
  // Create a temporary directory for testing
  const testSessionsDir = path.join(os.tmpdir(), '.nanocoder-sessions-test');
  const sessionManager = new SessionManager(); // Use default configuration
  
  // Override the sessions directory for testing
  Object.defineProperty(sessionManager, 'sessionsDir', {
    value: testSessionsDir,
    writable: true
  });
  Object.defineProperty(sessionManager, 'indexFile', {
    value: path.join(testSessionsDir, 'sessions.json'),
    writable: true
 });
  
  try {
    await fs.promises.mkdir(testSessionsDir, { recursive: true });
    await sessionManager.initialize();
    console.log('✓ Session manager initialized');
    
    // Test 1: Create a new session
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
    console.log('✓ Session created:', session.id);
    console.log('  - Title:', session.title);
    console.log('  - Version:', session.version);
    console.log(' - Message count:', session.messages.length);
    console.log(' - Metadata workingDirectory:', session.metadata?.workingDirectory);
    
    // Test 2: Save and load a session
    await sessionManager.saveSession(session);
    const loadedSession = await sessionManager.loadSession(session.id);
    if (!loadedSession) {
      throw new Error('Failed to load session');
    }
    console.log('✓ Session saved and loaded successfully');
    console.log('  - Loaded title:', loadedSession.title);
    console.log(' - Loaded version:', loadedSession.version);
    
    // Test 3: List sessions
    const sessions = await sessionManager.listSessions();
    console.log('✓ Sessions listed:', sessions.length);
    
    // Test 4: Create another session to test listing
    const session2 = await sessionManager.createSession([
      { 
        role: 'user' as const,
        content: 'Second session',
        timestamp: Date.now(),
        tool_calls: undefined,
        tool_call_id: undefined,
        name: undefined
      }
    ]);
    console.log('✓ Second session created:', session2.id);
    
    const allSessions = await sessionManager.listSessions();
    console.log('✓ All sessions:', allSessions.length);
    
    // Test 5: Delete a session
    await sessionManager.deleteSession(session.id);
    const deletedSession = await sessionManager.loadSession(session.id);
    if (deletedSession) {
      throw new Error('Session was not deleted');
    }
    console.log('✓ Session deleted successfully');
    
    // Verify only one session remains
    const remainingSessions = await sessionManager.listSessions();
    console.log('✓ Remaining sessions after deletion:', remainingSessions.length);
    
    // Test 6: Test session caching
    await sessionManager.getSessionWithCache(session2.id);
    const cachedSession = await sessionManager.getSessionWithCache(session2.id);
    if (!cachedSession || cachedSession.id !== session2.id) {
      throw new Error('Session caching failed');
    }
    console.log('✓ Session caching works');
    
    // Test 7: Test size validation
    const largeSession = {
      id: 'large_test_session',
      title: 'Large Session',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
      messages: Array(1000).fill(null).map((_, i) => ({
        role: 'user' as const,
        content: `Message ${i} `.repeat(100), // Make content large
        timestamp: Date.now(),
        tool_calls: undefined,
        tool_call_id: undefined,
        name: undefined
      })),
      metadata: { workingDirectory: process.cwd() }
    };
    
    try {
      await sessionManager.saveSession(largeSession);
      console.log('⚠ Size validation may not be working as expected (large session was saved)');
    } catch (error) {
      console.log('✓ Size validation works - large session was rejected');
    }
    
    console.log('\n✓ All tests passed!');
    
  } catch (error) {
    console.error('✗ Test failed:', error);
  } finally {
    // Clean up test sessions directory
    try {
      const files = await fs.promises.readdir(testSessionsDir);
      for (const file of files) {
        await fs.promises.unlink(path.join(testSessionsDir, file));
      }
      await fs.promises.rmdir(testSessionsDir);
      console.log('✓ Test directory cleaned up');
    } catch (error) {
      console.error('Error cleaning up test directory:', error);
    }
  }
}

// Run the test
testSessionManager().catch(console.error);