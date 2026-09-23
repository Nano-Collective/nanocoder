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
	/** True while a prompt turn is being processed. Overlapping calls wait on acquireTurn(). */
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

	/**
	 * FIFO lock so a follow-up `prompt()` waits for the in-flight turn instead
	 * of throwing. Overlapping calls used to surface in VS Code as
	 * `RequestError: Internal error`.
	 *
	 * The idle path claims the lock synchronously. `await` always yields, and
	 * a cancel that lands in that gap must abort the controller `beginTurn`
	 * just installed — not the one the next `beginTurn` would replace.
	 */
	private _held = false;
	private _waiters: Array<() => void> = [];

	acquireTurn(): {immediate: boolean; ready: Promise<void>} {
		if (!this._held) {
			this._held = true;
			this.turnActive = true;
			return {immediate: true, ready: Promise.resolve()};
		}
		return {
			immediate: false,
			ready: new Promise(resolve => {
				this._waiters.push(() => {
					this._held = true;
					this.turnActive = true;
					resolve();
				});
			}),
		};
	}

	releaseTurn(): void {
		const next = this._waiters.shift();
		if (next) {
			next();
			return;
		}
		this._held = false;
		this.turnActive = false;
	}
}
