import type {
	AgentSideConnection,
	ClientCapabilities,
} from '@agentclientprotocol/sdk';
import {SemanticMemoryManager} from '@/memory/semantic-memory-manager';
import {TimelineManager} from '@/services/timeline-manager';
import type {DevelopmentMode, Message} from '@/types/core';

export class AcpSession {
	readonly sessionId: string;
	readonly cwd: string;
	readonly conn: AgentSideConnection;
	readonly clientCapabilities?: ClientCapabilities;
	readonly timeline: TimelineManager;

	messages: Message[] = [];
	systemMessage?: Message;
	baseSystemMessage?: Message;
	abortController = new AbortController();
	developmentMode: DevelopmentMode;
	/** True while a prompt turn is being processed, to reject overlapping prompts. */
	turnActive = false;
	/** URI of the file currently focused in the editor client (e.g. VS Code). */
	activeFile?: string;
	private memoryFinder?: SemanticMemoryManager;

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
		this.timeline = new TimelineManager(options.cwd, options.sessionId);
	}

	getMemoryFinder(): SemanticMemoryManager {
		return (this.memoryFinder ??= new SemanticMemoryManager({cwd: this.cwd}));
	}

	cancel(): void {
		this.abortController.abort();
	}

	beginTurn(): void {
		this.abortController = new AbortController();
		this.turnActive = true;
	}
}
