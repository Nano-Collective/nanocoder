import type {
	AgentSideConnection,
	ClientCapabilities,
} from '@agentclientprotocol/sdk';
import type {DevelopmentMode, Message} from '@/types/core';

export class AcpSession {
	readonly sessionId: string;
	readonly cwd: string;
	readonly conn: AgentSideConnection;
	readonly clientCapabilities?: ClientCapabilities;

	messages: Message[] = [];
	systemMessage?: Message;
	abortController = new AbortController();
	developmentMode: DevelopmentMode;

	constructor(options: {
		sessionId: string;
		cwd: string;
		conn: AgentSideConnection;
		clientCapabilities?: ClientCapabilities;
		initialMode?: DevelopmentMode;
	}) {
		this.sessionId = options.sessionId;
		this.cwd = options.cwd;
		this.conn = options.conn;
		this.clientCapabilities = options.clientCapabilities;
		this.developmentMode = options.initialMode ?? 'auto-accept';
	}

	cancel(): void {
		this.abortController.abort();
		// Create a fresh controller for potential subsequent prompts
		this.abortController = new AbortController();
	}
}
