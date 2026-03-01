# Session Management

Nanocoder provides automatic session storage and management to save and restore chat conversations.

## Features

- **Automatic Session Saving**: Conversations are automatically saved to disk at regular intervals
- **Session Listing**: View and manage previous chat sessions
- **Session Resumption**: Resume any past session with full conversation context
- **Configuration Options**: Customize session behavior through configuration

## Storage Location

Sessions are stored in `~/.nanocoder-sessions/` by default, with the following structure:

```
~/.nanocoder-sessions/
├── sessions.json          # Index of all sessions
└── {session-id}.json      # Individual session files
```

## Configuration

Session behavior can be customized through the `agents.config.json` file:

```json
{
  "nanocoder": {
    "sessions": {
      "autoSave": true,
      "saveInterval": 30000,
      "maxSessions": 100,
      "retentionDays": 30,
      "directory": "~/.nanocoder-sessions"
    }
  }
}
```

### Configuration Options

- `autoSave`: Enable/disable automatic session saving (default: `true`)
- `saveInterval`: Time interval between saves in milliseconds (default: `30000` - 30 seconds)
- `maxSessions`: Maximum number of sessions to keep (default: `100`)
- `retentionDays`: Automatically delete sessions older than this many days (default: `30`)
- `directory`: Directory to store session files (default: `"~/.nanocoder-sessions"`)

## Commands

### `/resume`

Resume a previous chat session with various options:

- `/resume` - Show session selector UI
- `/resume {id}` - Resume specific session by ID
- `/resume {number}` - Resume by list index
- `/resume last` - Resume most recent session

Aliases: `/sessions`, `/history`

## Session Schema

Each session contains the following information:

```typescript
interface Session {
  id: string;              // Unique session ID (timestamp-based)
  title: string;           // Auto-generated from first message or manual
  createdAt: string;       // ISO timestamp
  lastAccessedAt: string;  // ISO timestamp
  messageCount: number;    // Number of messages
  provider: string;        // LLM provider used
  model: string;           // Model used
  workingDirectory: string; // CWD when session created
  messages: Message[];     // Full conversation history
}
```