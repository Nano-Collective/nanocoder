import type {
	WebClientEvent,
	WebServerEvent,
	WebSessionMessage,
	WebSessionSummary,
} from './protocol.js';

export interface WebSessionLoadResult {
	session: WebSessionSummary;
	messages: WebSessionMessage[];
}

export interface WebRuntimeHandlers {
	submitMessage: (text: string) => void | Promise<void>;
	cancel: () => void;
	resetSession: () => void | Promise<void>;
	listSessions: () => Promise<WebSessionSummary[]>;
	loadSession: (sessionId: string) => Promise<WebSessionLoadResult | null>;
}

export interface WebApprovalRequest {
	toolName: string;
	arguments: Record<string, unknown>;
	context?: string;
}

export interface WebQuestionRequest {
	question: string;
	options: string[];
	allowFreeform: boolean;
}

export interface WebRuntimeBridge {
	handleClientEvent: (event: WebClientEvent) => Promise<void>;
	bindRuntimeHandlers: (handlers: WebRuntimeHandlers) => () => void;
	publishAssistantContent: (content: string) => void;
	publishToolStarted: (id: string, name: string) => void;
	publishToolFinished: (id: string, name: string, ok: boolean) => void;
	hasActiveBrowserTurn: () => boolean;
	requestApproval: (request: WebApprovalRequest) => Promise<boolean>;
	requestQuestion: (request: WebQuestionRequest) => Promise<string>;
	completeTurn: () => void;
	failTurn: (error: unknown) => void;
	handleDisconnect: () => void;
}

type PendingInteraction =
	| {
			id: string;
			kind: 'approval';
			resolve: (approved: boolean) => void;
	  }
	| {
			id: string;
			kind: 'question';
			resolve: (answer: string) => void;
			reject: (error: Error) => void;
	  };

export function createWebRuntimeBridge(
	broadcastEvent: (event: WebServerEvent) => void,
): WebRuntimeBridge {
	let runtimeHandlers: WebRuntimeHandlers | null = null;
	let activeTurnId: string | null = null;
	let previousAssistantContent = '';
	let pendingInteraction: PendingInteraction | null = null;
	let interactionCounter = 0;

	const clearActiveTurn = () => {
		activeTurnId = null;
		previousAssistantContent = '';
	};

	const settlePendingInteraction = (options: {
		denyApprovals: boolean;
		rejectQuestions: boolean;
		questionMessage?: string;
	}) => {
		const pending = pendingInteraction;
		pendingInteraction = null;
		if (!pending) {
			return;
		}

		if (pending.kind === 'approval') {
			pending.resolve(false);
			return;
		}

		if (options.rejectQuestions) {
			pending.reject(
				new Error(
					options.questionMessage ??
						'The browser question was cancelled before an answer arrived.',
				),
			);
			return;
		}

		pending.resolve('');
	};

	const completeActiveTurn = (expectedTurnId?: string) => {
		if (!activeTurnId || (expectedTurnId && activeTurnId !== expectedTurnId)) {
			return;
		}

		settlePendingInteraction({
			denyApprovals: true,
			rejectQuestions: true,
			questionMessage:
				'The browser turn completed before the question was answered.',
		});
		broadcastEvent({type: 'turn_completed', id: activeTurnId});
		clearActiveTurn();
	};

	const failActiveTurn = (error: unknown, expectedTurnId?: string) => {
		if (!activeTurnId || (expectedTurnId && activeTurnId !== expectedTurnId)) {
			return;
		}

		settlePendingInteraction({
			denyApprovals: true,
			rejectQuestions: true,
			questionMessage:
				'The browser turn failed before the question was answered.',
		});
		broadcastEvent({
			type: 'error',
			message:
				error instanceof Error
					? error.message
					: 'Nanocoder could not complete this turn.',
		});
		clearActiveTurn();
	};

	const nextInteractionId = (kind: 'approval' | 'question') => {
		interactionCounter += 1;
		return `browser-${kind}-${interactionCounter}`;
	};

	return {
		async handleClientEvent(event) {
			if (event.type === 'hello') {
				return;
			}

			if (!runtimeHandlers) {
				throw new Error('Nanocoder runtime is still starting.');
			}

			if (event.type === 'approval_response') {
				if (!activeTurnId) {
					throw new Error('No browser turn is waiting for approval.');
				}

				if (
					!pendingInteraction ||
					pendingInteraction.kind !== 'approval' ||
					pendingInteraction.id !== event.id
				) {
					throw new Error(
						'This approval response does not match a pending request.',
					);
				}

				const pending = pendingInteraction;
				pendingInteraction = null;
				pending.resolve(event.approved);
				return;
			}

			if (event.type === 'question_response') {
				if (!activeTurnId) {
					throw new Error('No browser turn is waiting for a question answer.');
				}

				if (
					!pendingInteraction ||
					pendingInteraction.kind !== 'question' ||
					pendingInteraction.id !== event.id
				) {
					throw new Error(
						'This question response does not match a pending request.',
					);
				}

				const pending = pendingInteraction;
				pendingInteraction = null;
				pending.resolve(event.answer);
				return;
			}

			if (event.type === 'cancel') {
				if (!activeTurnId || event.id !== activeTurnId) {
					throw new Error('This browser turn is no longer active.');
				}

				settlePendingInteraction({
					denyApprovals: true,
					rejectQuestions: true,
					questionMessage:
						'The browser turn was cancelled before the question was answered.',
				});
				runtimeHandlers.cancel();
				return;
			}

			if (event.type === 'reset_session') {
				if (activeTurnId) {
					throw new Error(
						'Cannot start a new chat while a browser turn is active.',
					);
				}

				await runtimeHandlers.resetSession();
				return;
			}

			if (event.type === 'list_sessions') {
				const sessions = await runtimeHandlers.listSessions();
				broadcastEvent({type: 'sessions', id: event.id, sessions});
				return;
			}

			if (event.type === 'load_session') {
				if (activeTurnId) {
					throw new Error(
						'Cannot switch sessions while a browser turn is active.',
					);
				}

				const result = await runtimeHandlers.loadSession(event.sessionId);
				if (!result) {
					throw new Error('Session not found.');
				}

				broadcastEvent({
					type: 'session_loaded',
					id: event.id,
					session: result.session,
					messages: result.messages,
				});
				return;
			}

			if (activeTurnId) {
				throw new Error('Nanocoder is already processing a browser turn.');
			}

			activeTurnId = event.id;
			previousAssistantContent = '';

			try {
				const submission = runtimeHandlers.submitMessage(event.text);
				void Promise.resolve(submission).then(
					() => completeActiveTurn(event.id),
					error => failActiveTurn(error, event.id),
				);
			} catch (error) {
				clearActiveTurn();
				throw error;
			}
		},

		bindRuntimeHandlers(handlers) {
			runtimeHandlers = handlers;

			return () => {
				if (runtimeHandlers === handlers) {
					settlePendingInteraction({
						denyApprovals: true,
						rejectQuestions: true,
						questionMessage:
							'The browser runtime was unbound before the question was answered.',
					});
					runtimeHandlers = null;
				}
			};
		},

		publishAssistantContent(content) {
			if (!activeTurnId) {
				return;
			}

			if (content.length === 0) {
				previousAssistantContent = '';
				return;
			}

			const delta = content.startsWith(previousAssistantContent)
				? content.slice(previousAssistantContent.length)
				: content;
			previousAssistantContent = content;

			if (delta.length > 0) {
				broadcastEvent({
					type: 'assistant_delta',
					id: activeTurnId,
					text: delta,
				});
			}
		},

		publishToolStarted(id, name) {
			if (!activeTurnId) {
				return;
			}

			broadcastEvent({type: 'tool_started', id, name});
		},

		publishToolFinished(id, name, ok) {
			if (!activeTurnId) {
				return;
			}

			broadcastEvent({type: 'tool_finished', id, name, ok});
		},

		hasActiveBrowserTurn() {
			return activeTurnId !== null;
		},

		requestApproval(request) {
			if (!activeTurnId) {
				return Promise.resolve(false);
			}

			if (pendingInteraction) {
				return Promise.resolve(false);
			}

			const id = nextInteractionId('approval');
			return new Promise<boolean>(resolve => {
				pendingInteraction = {
					id,
					kind: 'approval',
					resolve,
				};
				broadcastEvent({
					type: 'approval_required',
					id,
					toolName: request.toolName,
					arguments: sanitizeJsonRecord(request.arguments),
					...(request.context ? {context: request.context} : {}),
				});
			});
		},

		requestQuestion(request) {
			if (!activeTurnId) {
				return Promise.reject(
					new Error('No browser turn is active for this question.'),
				);
			}

			if (pendingInteraction) {
				return Promise.reject(
					new Error('Another browser interaction is already pending.'),
				);
			}

			const id = nextInteractionId('question');
			return new Promise<string>((resolve, reject) => {
				pendingInteraction = {
					id,
					kind: 'question',
					resolve,
					reject,
				};
				broadcastEvent({
					type: 'question_required',
					id,
					question: request.question,
					options: [...request.options],
					allowFreeform: request.allowFreeform,
				});
			});
		},

		completeTurn() {
			completeActiveTurn();
		},

		failTurn(error) {
			failActiveTurn(error);
		},

		handleDisconnect() {
			settlePendingInteraction({
				denyApprovals: true,
				rejectQuestions: true,
				questionMessage:
					'The browser disconnected before the question was answered.',
			});
		},
	};
}

function sanitizeJsonRecord(
	value: Record<string, unknown>,
): Record<string, unknown> {
	try {
		return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
	} catch {
		return {};
	}
}
