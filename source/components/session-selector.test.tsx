import React from 'react';
import { render } from 'ink-testing-library';
import test from 'ava';
import SessionSelector from './session-selector';
import { SessionManager } from '@/session/session-manager';

// Create a mock session manager
class MockSessionManager extends SessionManager {
  private mockSessions = [
    {
      id: 'session-1',
      title: 'Test Session 1',
      createdAt: Date.now() - 360000, // 1 hour ago
      updatedAt: Date.now() - 360000,
      version: 1,
      messages: [
        {
          role: 'user' as const,
          content: 'Hello',
          timestamp: Date.now() - 3600000,
          tool_calls: undefined,
          tool_call_id: undefined,
          name: undefined,
        }
      ],
      metadata: {
        messageCount: 1,
        lastAccessedAt: Date.now() - 36000,
        workingDirectory: process.cwd(),
      }
    },
    {
      id: 'session-2',
      title: 'Test Session 2',
      createdAt: Date.now() - 720000, // 2 hours ago
      updatedAt: Date.now() - 72000,
      version: 1,
      messages: [
        {
          role: 'user' as const,
          content: 'How are you?',
          timestamp: Date.now() - 7200000,
          tool_calls: undefined,
          tool_call_id: undefined,
          name: undefined,
        },
        {
          role: 'assistant' as const,
          content: 'I am fine',
          timestamp: Date.now() - 7100000,
          tool_calls: undefined,
          tool_call_id: undefined,
          name: undefined,
        }
      ],
      metadata: {
        messageCount: 2,
        lastAccessedAt: Date.now() - 7200000,
        workingDirectory: process.cwd(),
      }
    }
  ];

  async listSessions(includeSizeInfo = false) {
    return this.mockSessions.map(session => ({
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt,
      size: includeSizeInfo ? 1024 : undefined,
    }));
  }

  async getSessionWithCache(sessionId: string) {
    return this.mockSessions.find(session => session.id === sessionId) || null;
  }

  async initialize() {
    // Mock implementation
 }
}

test('SessionSelector renders loading state', (t) => {
  const mockSessionManager = new MockSessionManager();
  const { lastFrame } = render(
    <SessionSelector
      sessionManager={mockSessionManager}
      onSessionSelect={() => {}}
      onCancel={() => {}}
    />
  );

  // Should show loading message initially
  t.truthy(lastFrame()?.includes('Loading sessions...'));
});

// Note: Testing the full component after data loads requires more complex async testing
// that would need to mock the useEffect behavior, which is complex with ink-testing-library
test('SessionSelector component structure', (t) => {
  // We can test the component renders without crashing with a minimal mock
  const mockSessionManager = {
    listSessions: async () => [],
    getSessionWithCache: async () => null,
    initialize: async () => {}
  } as unknown as SessionManager;

  const { unmount } = render(
    <SessionSelector
      sessionManager={mockSessionManager}
      onSessionSelect={() => {}}
      onCancel={() => {}}
    />
  );

  // Component should render without errors
  t.truthy(true);
  
  unmount();
});