import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadPreferences } from '@/config/preferences';

/**
 * Interface representing a session with all its properties
 */
export interface Session {
  id: string;
  title: string;
 createdAt: number;
 updatedAt: number;
 version: number; // Schema version for backward compatibility
  messages: Array<{
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: number;
    tool_calls?: Array<{
      id: string;
      function: {
        name: string;
        arguments: Record<string, unknown>;
      };
    }>;
    tool_call_id?: string;
    name?: string;
  }>;
  metadata?: {
    messageCount?: number;
    lastAccessedAt?: number;
    provider?: string;
    model?: string;
    workingDirectory?: string;
    size?: number; // Size in bytes
    [key: string]: any;
  };
}

/**
 * Session configuration interface
 */
export interface SessionConfig {
  autoSave?: boolean;
 saveInterval?: number;
  maxSessions?: number;
  retentionDays?: number;
  directory?: string;
  maxSizeMB?: number;
  diskSpaceThreshold?: number;
}

/**
 * Session Manager class to handle all session-related operations
 */
export class SessionManager {
  private readonly sessionsDir: string;
  private readonly indexFile: string;
  private autoSaveInterval: NodeJS.Timeout | null = null;
  private readonly autoSaveDelay: number; // 30 seconds by default
  private readonly sessionCache: Map<string, Session> = new Map(); // Session caching
  private readonly sessionIndexCache: Array<{id: string, title: string, updatedAt: number, size?: number}> | null = null; // Index caching
  private readonly maxSessionAgeDays: number; // Auto-delete sessions older than X days (configurable)
  private readonly maxSessionSizeMB: number; // Max session size in MB
 private readonly maxSessions: number; // Max number of sessions to keep
  private readonly diskSpaceThreshold: number; // Use max 90% of available disk space

  constructor() {
    // Load session configuration from preferences
    const preferences = loadPreferences();
    const sessionConfig = preferences.sessions || {};
    
    this.maxSessionAgeDays = sessionConfig.retentionDays ?? 30;
    this.maxSessionSizeMB = sessionConfig.maxSizeMB ?? 10;
    this.maxSessions = sessionConfig.maxSessions ?? 100; // Default to 100 as per requirements
    this.autoSaveDelay = sessionConfig.saveInterval ?? 5000; // Default to 5 seconds instead of 30
    this.diskSpaceThreshold = sessionConfig.diskSpaceThreshold ?? 0.9; // Use 90% of available disk space
    
    // Use configured directory or default
    const sessionDir = sessionConfig.directory ?? path.join(process.cwd(), '.nanocoder-sessions');
    // Replace ~ with home directory if needed
    this.sessionsDir = sessionDir.startsWith('~')
      ? path.join(os.homedir(), sessionDir.substring(2))
      : sessionDir;
    
    this.indexFile = path.join(this.sessionsDir, 'sessions.json');
 }

  /**
   * Initialize the session manager by ensuring the sessions directory exists
   */
  public async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.sessionsDir, { recursive: true });
      // Ensure the index file exists
      try {
        await fs.access(this.indexFile);
      } catch {
        // Create an empty index file if it doesn't exist
        await this.saveSessionIndex([]);
      }
    } catch (error) {
      throw new Error(`Failed to initialize session manager: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

 /**
   * Check available disk space
   */
  protected async checkDiskSpace(): Promise<{available: number, total: number, used: number}> {
    // On Linux, we can use df command to check disk space
    try {
      const result = await import('child_process').then(cp =>
        new Promise<{available: number, total: number, used: number}>((resolve, reject) => {
          cp.exec('df -k .', (error, stdout) => {
            if (error) {
              // Fallback: return some default values
              resolve({ available: 1000000, total: 100000, used: 0 }); // 1GB default
              return;
            }
            
            const lines = stdout.trim().split('\n');
            if (lines.length < 2) {
              resolve({ available: 1000000000, total: 10000000, used: 0 });
              return;
            }
            
            const diskInfo = lines[1].split(/\s+/);
            const total = parseInt(diskInfo[1]) * 1024; // Convert KB to bytes
            const used = parseInt(diskInfo[2]) * 1024;   // Convert KB to bytes
            const available = parseInt(diskInfo[3]) * 1024; // Convert KB to bytes
            
            resolve({ available, total, used });
          });
        })
      );
      return result;
    } catch (error) {
      // Fallback: return default values if df command fails
      return { available: 100000, total: 10000000, used: 0 }; // 1GB default
    }
 }

  /**
   * Check if there's enough disk space to save a session
   */
 private async hasEnoughDiskSpace(sessionSize: number): Promise<boolean> {
    const diskInfo = await this.checkDiskSpace();
    const thresholdBytes = Math.floor(diskInfo.total * this.diskSpaceThreshold);
    const currentUsed = diskInfo.used;
    
    // Check if adding this session would exceed the threshold
    return (currentUsed + sessionSize) <= thresholdBytes;
  }

  /**
   * Get the size of a session in bytes
   */
  private getSessionSize(session: Session): number {
    return Buffer.byteLength(JSON.stringify(session), 'utf8');
  }

  /**
   * Check if session size exceeds the limit
   */
  private isSessionSizeValid(session: Session): boolean {
    const size = this.getSessionSize(session);
    const maxSizeBytes = this.maxSessionSizeMB * 1024 * 1024; // Convert MB to bytes
    return size <= maxSizeBytes;
  }
  
  /**
   * Enforce the maximum number of sessions limit by deleting oldest sessions
   */
  protected async enforceMaxSessionsLimit(): Promise<void> {
    try {
      // Load current configuration to get max sessions
      const preferences = loadPreferences();
      const maxSessions = preferences.sessions?.maxSessions ?? this.maxSessions;
      
      const sessions = await this.getSessionIndex();
      
      // If we're under the limit, no need to delete anything
      if (sessions.length <= maxSessions) {
        return;
      }
      
      // Sort sessions by updatedAt (oldest first) and get the ones to delete
      const sortedSessions = sessions.sort((a, b) => a.updatedAt - b.updatedAt);
      const sessionsToDelete = sortedSessions.slice(0, sessions.length - maxSessions);
      
      // Delete the oldest sessions
      for (const session of sessionsToDelete) {
        try {
          await this.deleteSession(session.id);
          console.log(`Deleted session due to max sessions limit: ${session.id}`);
        } catch (error) {
          console.error(`Failed to delete session ${session.id} due to max sessions limit:`, error);
        }
      }
    } catch (error) {
      console.error('Failed to enforce max sessions limit:', error);
    }
  }
  /**
   * Auto-delete sessions older than X days
   */
 public async cleanupOldSessions(): Promise<void> {
    try {
      // Load current configuration to get retention days
      const preferences = loadPreferences();
      const retentionDays = preferences.sessions?.retentionDays ?? this.maxSessionAgeDays;
      
      const sessions = await this.getSessionIndex();
      const now = Date.now();
      const cutoffDate = now - (retentionDays * 24 * 60 * 1000); // Convert days to milliseconds
      
      const oldSessions = sessions.filter(session => session.updatedAt < cutoffDate);
      
      for (const session of oldSessions) {
        try {
          await this.deleteSession(session.id);
          console.log(`Deleted old session: ${session.id}`);
        } catch (error) {
          console.error(`Failed to delete old session ${session.id}:`, error);
        }
      }
    } catch (error) {
      throw new Error(`Failed to cleanup old sessions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Migrate an older session to the current schema version
   */
  private migrateSession(session: any): Session {
    // If session doesn't have a version, assume it's version 1
    if (typeof session.version === 'undefined') {
      session.version = 1;
    }
    
    // If session has old message format, migrate it
    if (session.messages && Array.isArray(session.messages)) {
      session.messages = session.messages.map((msg: any) => {
        // Ensure all required properties exist
        if (!msg.timestamp) msg.timestamp = Date.now();
        if (!msg.role) msg.role = 'user';
        if (typeof msg.content === 'undefined') msg.content = '';
        
        // Handle legacy tool_call format that might have been used in older sessions
        if (msg.tool_call) {
          if (!msg.tool_calls) {
            // Convert old single tool_call to new tool_calls array format
            msg.tool_calls = [{
              id: `tool_call_${Date.now()}`,
              function: {
                name: msg.tool_call,
                arguments: msg.tool_call_args || {}
              }
            }];
          }
          // Remove the old field
          delete msg.tool_call;
        }
        
        // Ensure tool_calls is an array if it exists
        if (msg.tool_calls && !Array.isArray(msg.tool_calls)) {
          // Convert single tool call to array format
          const singleToolCall = msg.tool_calls;
          msg.tool_calls = [singleToolCall];
        }
        
        // For legacy tool calls, ensure they have proper structure
        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
          msg.tool_calls = msg.tool_calls.map((toolCall: any) => {
            // Ensure each tool call has required fields
            if (!toolCall.id) {
              toolCall.id = `tool_call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            }
            
            if (!toolCall.function) {
              toolCall.function = {
                name: 'unknown_function',
                arguments: {}
              };
            } else {
              if (!toolCall.function.name) {
                toolCall.function.name = 'unknown_function';
              }
              if (!toolCall.function.arguments) {
                toolCall.function.arguments = {};
              }
            }
            
            return toolCall;
          });
        }
        
        // If it's an old format without tool properties, add them
        if (typeof msg.tool_calls === 'undefined') msg.tool_calls = undefined;
        if (typeof msg.tool_call_id === 'undefined') msg.tool_call_id = undefined;
        if (typeof msg.name === 'undefined') msg.name = undefined;
        
        return msg;
      });
    }
    
    // Ensure metadata exists
    if (!session.metadata) {
      session.metadata = {};
    }
    
    // Update version to current
    session.version = 1;
    
    return session as Session;
  }

  /**
   * Validate loaded messages match current tool schema
   * This method is now more permissive to allow for legacy session formats
   */
   private validateMessages(messages: Session['messages']): boolean {
     try {
       for (const message of messages) {
         // Allow any string role (not just the predefined ones) for backward compatibility
         if (typeof message.role !== 'string') {
           console.warn(`Invalid message role type: ${typeof message.role}`);
           return false;
         }
         
         // Allow any content type (not just string) but check it exists
         if (typeof message.content === 'undefined') {
           console.warn(`Missing message content`);
           return false;
         }
         
         // For tool_calls, be more forgiving to handle legacy formats
         if (message.tool_calls) {
           if (!Array.isArray(message.tool_calls)) {
             console.warn(`Invalid tool_calls format, not an array`);
             return false;
           }
           
           for (const toolCall of message.tool_calls) {
             if (!toolCall.id) {
               console.warn(`Missing tool_call id`);
               return false;
             }
             
             if (!toolCall.function) {
               console.warn(`Missing tool_call function`);
               return false;
             }
             
             if (!toolCall.function.name) {
               console.warn(`Missing tool_call function name`);
               return false;
             }
             
             // Don't strictly validate arguments structure for legacy compatibility
             if (typeof toolCall.function.arguments === 'undefined') {
               console.warn(`Tool call missing arguments, setting to empty object`);
               toolCall.function.arguments = {};
             }
           }
         }
       }
       return true;
     } catch (error) {
       console.error('Error validating messages:', error);
       return false;
     }
   }

  /**
    * Load a session from disk by ID with error handling for corrupted files
    */
   public async loadSession(sessionId: string, validate = true): Promise<Session | null> {
     try {
       const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
       const data = await fs.readFile(sessionFile, 'utf8');
       
       // Try to parse the session data
       let session: any;
       try {
         session = JSON.parse(data) as Session;
       } catch (parseError) {
         console.error(`Failed to parse session file ${sessionId}:`, parseError);
         return null; // Return null for corrupted session files
       }
       
       // Migrate older sessions to current schema
       if (session.version === undefined || session.version < 1) {
         session = this.migrateSession(session);
       }
       
       // Validate messages if requested
       if (validate && !this.validateMessages(session.messages)) {
         console.warn(`Session ${sessionId} has invalid messages`);
         return null;
       }
       
       // Check if provider/model is still available
       this.checkProviderModelAvailability(session);
       
       // Handle sessions from different working directories
       this.handleWorkingDirectory(session);
       
       // Add to cache
       this.sessionCache.set(sessionId, session);
       
       // Update last accessed time
       if (session.metadata) {
         session.metadata.lastAccessedAt = Date.now();
       } else {
         session.metadata = { lastAccessedAt: Date.now() };
       }
       
       return session;
     } catch (error) {
       if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
         return null; // Session file doesn't exist
       }
       console.error(`Failed to load session ${sessionId}:`, error);
       return null; // Return null instead of throwing for corrupted files
     }
   }

   /**
    * Check if provider/model is still available
    */
   private checkProviderModelAvailability(session: Session): void {
     if (session.metadata?.provider && session.metadata?.model) {
       // In a real implementation, you would check if the provider/model is still available
       // For now, we'll just log a warning if they're not available
       console.log(`Session uses provider: ${session.metadata.provider}, model: ${session.metadata.model}`);
     }
   }

  /**
    * Handle sessions from different working directories
    */
   private handleWorkingDirectory(session: Session): void {
     if (session.metadata?.workingDirectory) {
       // Compare with current working directory
       const currentDir = process.cwd();
       if (session.metadata.workingDirectory !== currentDir) {
         console.log(`Session was created in different directory: ${session.metadata.workingDirectory}, current: ${currentDir}`);
         // You might want to handle this differently based on your needs
       }
     } else {
       // Add current working directory if not present
       if (!session.metadata) {
         session.metadata = {};
       }
       session.metadata.workingDirectory = process.cwd();
     }
   }

  /**
   * Create a new session
   */
  public async createSession(initialMessages: Session['messages'] = []): Promise<Session> {
    const id = this.generateSessionId();
    const title = await this.generateImprovedSessionTitle(initialMessages);
    
    const session: Session = {
      id,
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1, // Current schema version
      messages: initialMessages,
      metadata: {
        messageCount: initialMessages.length,
        lastAccessedAt: Date.now(),
        workingDirectory: process.cwd(),
      }
   };
  
    await this.saveSession(session);
    return session;
  }

 /**
  * Save a session to disk with size and disk space checks
  */
 public async saveSession(session: Session): Promise<void> {
   try {
     session.updatedAt = Date.now();
     
     // Update the title if it's still untitled but now has meaningful content
     if (!session.title || session.title === 'Untitled Session' || session.title.includes('Untitled')) {
       const newTitle = await this.generateImprovedSessionTitle(session.messages);
       if (newTitle && newTitle !== 'Untitled Session' && !newTitle.includes('Untitled')) {
         session.title = newTitle;
       }
     }
     
     // Check if session size exceeds limit
     if (!this.isSessionSizeValid(session)) {
       throw new Error(`Session size exceeds limit of ${this.maxSessionSizeMB}MB`);
     }
     
     // Check available disk space
     const sessionSize = this.getSessionSize(session);
     const hasSpace = await this.hasEnoughDiskSpace(sessionSize);
     if (!hasSpace) {
       throw new Error('Insufficient disk space to save session');
     }
     
     // Write the session data to its own file
     const sessionFile = path.join(this.sessionsDir, `${session.id}.json`);
     await fs.writeFile(sessionFile, JSON.stringify(session, null, 2), 'utf8');

     // Update the index file to include this session
     const sessions = await this.getSessionIndex();
     const existingIndex = sessions.findIndex(s => s.id === session.id);
     
     if (existingIndex !== -1) {
       sessions[existingIndex] = {
         id: session.id,
         title: session.title,
         updatedAt: session.updatedAt
       };
     } else {
       sessions.push({
         id: session.id,
         title: session.title,
         updatedAt: session.updatedAt
       });
     }
     
     await this.saveSessionIndex(sessions);
     
     // Update cache
     this.sessionCache.set(session.id, session);
     
     // Enforce max sessions limit
     await this.enforceMaxSessionsLimit();
   } catch (error) {
     throw new Error(`Failed to save session: ${error instanceof Error ? error.message : String(error)}`);
   }
 }

  // The enhanced loadSession method is already implemented above with validation and error handling

  /**
   * List all available sessions with optional size information
   */
  public async listSessions(includeSizeInfo: boolean = false): Promise<Array<{id: string, title: string, updatedAt: number, size?: number}>> {
    try {
      let sessions = await this.getSessionIndex();
      
      // Add size information if requested
      if (includeSizeInfo) {
        sessions = await Promise.all(sessions.map(async (session) => {
          const sessionFile = path.join(this.sessionsDir, `${session.id}.json`);
          try {
            const stats = await fs.stat(sessionFile);
            return {
              ...session,
              size: stats.size
            };
          } catch (error) {
            // If we can't get the size, return without it
            return session;
          }
        }));
      }
      
      return sessions;
    } catch (error) {
      throw new Error(`Failed to list sessions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get a session from cache if available, otherwise load from disk
   */
  public async getSessionWithCache(sessionId: string, useCache: boolean = true): Promise<Session | null> {
    if (useCache && this.sessionCache.has(sessionId)) {
      const cachedSession = this.sessionCache.get(sessionId)!;
      // Update last accessed time
      if (cachedSession.metadata) {
        cachedSession.metadata.lastAccessedAt = Date.now();
      } else {
        cachedSession.metadata = { lastAccessedAt: Date.now() };
      }
      return cachedSession;
    }
    
    const session = await this.loadSession(sessionId);
    if (session && useCache) {
      this.sessionCache.set(sessionId, session);
    }
    return session;
  }

  /**
   * Clear the session cache
   */
  public clearSessionCache(): void {
    this.sessionCache.clear();
  }

  /**
   * Preload session index for optimization
   */
 public async preloadSessionIndex(): Promise<void> {
    // This method preloads the index to optimize for large session lists
    // In a real implementation, we might cache this information
    await this.getSessionIndex();
  }

  /**
   * Delete a session and remove it from the index
   */
  public async deleteSession(sessionId: string): Promise<void> {
    try {
      // Remove the session file
      const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
      try {
        await fs.unlink(sessionFile);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
        // File doesn't exist, which is fine
      }

      // Update the index file to remove this session
      const sessions = await this.getSessionIndex();
      const filteredSessions = sessions.filter(s => s.id !== sessionId);
      await this.saveSessionIndex(filteredSessions);
    } catch (error) {
      throw new Error(`Failed to delete session: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Start the auto-save functionality
   */
  public startAutoSave(): void {
    // Check if auto-save is enabled in config
    const preferences = loadPreferences();
    const autoSaveEnabled = preferences.sessions?.autoSave ?? true; // Default to true
    
    if (!autoSaveEnabled) {
      console.log('Auto-save is disabled by configuration');
      return;
    }
    
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }

    // The actual saving is handled by the debounced save mechanism in the UI
    // This interval serves as a backup to periodically run maintenance tasks
    this.autoSaveInterval = setInterval(async () => {
      // Run cleanup of old sessions periodically
      await this.cleanupOldSessions().catch(error => {
        console.error('Failed to cleanup old sessions during auto-save:', error);
      });
    }, this.autoSaveDelay);
  }

  /**
   * Stop the auto-save functionality
   */
  public stopAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
  }

  /**
   * Generate a session title based on the first user message
   */
  public generateSessionTitle(messages: Session['messages']): string {
    if (messages.length === 0) {
      return 'Untitled Session';
    }

    // Find the first user message
    const firstUserMessage = messages.find(msg => msg.role === 'user');
    
    if (firstUserMessage) {
      // Take the first 50 characters of the message and append '...' if it's longer
      const content = firstUserMessage.content.trim();
      if (content.length <= 50) {
        return content;
      }
      return content.substring(0, 47) + '...';
    }

    return 'Untitled Session';
  }

  /**
   * Generate a more descriptive session title using the first few messages
   * This can be enhanced to use an LLM for better titles
   */
  public async generateImprovedSessionTitle(messages: Session['messages']): Promise<string> {
    if (messages.length === 0) {
      return 'Untitled Session';
    }

    // Get the first few user messages to create a more descriptive title
    const userMessages = messages.filter(msg => msg.role === 'user').slice(0, 3);
    
    if (userMessages.length === 0) {
      return 'Untitled Session';
    }

    // Create a title based on the first user message
    const firstUserMessage = userMessages[0];
    let title = firstUserMessage.content.trim();
    
    // If the first message is too long, truncate it
    if (title.length > 50) {
      title = title.substring(0, 47) + '...';
    }
    
    // If we have multiple messages, add a note about the number
    if (userMessages.length > 1) {
      title += ` +${userMessages.length - 1}`;
    }

    return title;
  }

  /**
   * Get the session index from the index file
   */
  private async getSessionIndex(): Promise<Array<{id: string, title: string, updatedAt: number}>> {
    try {
      const data = await fs.readFile(this.indexFile, 'utf8');
      const parsed = JSON.parse(data);
      
      // Ensure the parsed data is an array
      if (!Array.isArray(parsed)) {
        console.warn(`Session index file ${this.indexFile} does not contain an array, using empty array`);
        return [];
      }
      
      // Validate that each item has the required properties
      const validSessions = parsed.filter(item =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        typeof item.updatedAt === 'number'
      ) as Array<{id: string, title: string, updatedAt: number}>;
      
      return validSessions;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Index file doesn't exist, return empty array
        return [];
      }
      console.error(`Error reading session index:`, error);
      // Return empty array if there's an error
      return [];
    }
  }

  /**
   * Save the session index to the index file
   */
  private async saveSessionIndex(sessions: Array<{id: string, title: string, updatedAt: number}>): Promise<void> {
    await fs.writeFile(this.indexFile, JSON.stringify(sessions, null, 2), 'utf8');
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    // Generate a unique ID using timestamp and random component
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clean up resources before shutdown
   */
  public async cleanup(): Promise<void> {
    this.stopAutoSave();
    // Clear session cache to free memory
    this.sessionCache.clear();
  }
}