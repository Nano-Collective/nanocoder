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
	submitMessage: (
		text: string,
		images?: {data: string; mediaType: string}[],
	) => void | Promise<void>;
	cancel: () => void;
	resetSession: () => void | Promise<void>;
	listSessions: () => Promise<WebSessionSummary[]>;
	loadSession: (sessionId: string) => Promise<WebSessionLoadResult | null>;
	deleteSession: (sessionId: string) => Promise<void>;
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
	requestApproval: (
		request: WebApprovalRequest,
		signal?: AbortSignal,
	) => Promise<boolean>;
	requestQuestion: (
		request: WebQuestionRequest,
		signal?: AbortSignal,
	) => Promise<string>;
	getStateEvents: () => WebServerEvent[];
	completeTurn: () => void;
	failTurn: (error: unknown) => void;
	handleDisconnect: () => void;
}

type PendingInteraction =
	| {
			id: string;
			kind: 'approval';
			resolve: (approved: boolean) => void;
			event: WebServerEvent;
			cleanup: () => void;
	  }
	| {
			id: string;
			kind: 'question';
			resolve: (answer: string) => void;
			reject: (error: Error) => void;
			event: WebServerEvent;
			cleanup: () => void;
	  };

export function createWebRuntimeBridge(
	broadcastEvent: (event: WebServerEvent) => void,
): WebRuntimeBridge {
	let runtimeHandlers: WebRuntimeHandlers | null = null;
	let activeTurnId: string | null = null;
	let previousAssistantContent = '';
	let pendingInteraction: PendingInteraction | null = null;
	let interactionCounter = 0;
	const interactions: PendingInteraction[] = [];
	let messages: WebSessionMessage[] = [];
	let session: WebSessionSummary | null = null;
	let sessionBusy = false;
	let sessionRevision = 0;
	let assistantId: string | null = null;
	let responseCounter = 0;
	const stateEvent = (): WebServerEvent => ({
		type: 'state',
		activeTurnId,
		messages: structuredClone(messages),
		session,
		busy: sessionBusy,
		sessionRevision,
	});
	const publishState = () => {
		broadcastEvent(stateEvent());
		if (pendingInteraction) broadcastEvent(pendingInteraction.event);
	};
	const advanceInteraction = () => {
		pendingInteraction = interactions[0] ?? null;
		if (pendingInteraction) broadcastEvent(pendingInteraction.event);
	};
	const removeInteraction = (pending: PendingInteraction) => {
		const index = interactions.indexOf(pending);
		if (index < 0) return;
		interactions.splice(index, 1);
		pending.cleanup();
		broadcastEvent({type: 'interaction_closed', id: pending.id});
		if (index === 0) advanceInteraction();
	};
	const enqueueInteraction = (
		pending: PendingInteraction,
		signal?: AbortSignal,
	) => {
		const abort = () => {
			removeInteraction(pending);
			if (pending.kind === 'approval') pending.resolve(false);
			else
				pending.resolve(
					'Error: The question was cancelled before it was answered.',
				);
		};
		pending.cleanup = () => signal?.removeEventListener('abort', abort);
		interactions.push(pending);
		if (signal?.aborted) abort();
		else {
			signal?.addEventListener('abort', abort, {once: true});
			if (interactions.length === 1) advanceInteraction();
		}
	};

	const clearActiveTurn = () => {
		activeTurnId = null;
		previousAssistantContent = '';
		assistantId = null;
	};

	const settlePendingInteraction = (options: {
		denyApprovals: boolean;
		rejectQuestions: boolean;
		questionMessage?: string;
	}) => {
		const waiting = interactions.splice(0);
		pendingInteraction = null;
		for (const pending of waiting) {
			pending.cleanup();
			broadcastEvent({type: 'interaction_closed', id: pending.id});
			if (pending.kind === 'approval') pending.resolve(false);
			else if (options.rejectQuestions)
				pending.reject(
					new Error(
						options.questionMessage ??
							'The browser question was cancelled before an answer arrived.',
					),
				);
			else pending.resolve('');
		}
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
		publishState();
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
			id: activeTurnId,
			message:
				error instanceof Error
					? error.message
					: 'Nanocoder could not complete this turn.',
		});
		clearActiveTurn();
		publishState();
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
				removeInteraction(pending);
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
				removeInteraction(pending);
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

			if (sessionBusy && event.type !== 'list_sessions') {
				throw new Error('A session operation is already in progress.');
			}

			if (event.type === 'reset_session') {
				if (activeTurnId) {
					throw new Error(
						'Cannot start a new chat while a browser turn is active.',
					);
				}

				sessionBusy = true;
				publishState();
				try {
					await runtimeHandlers.resetSession();
					messages = [];
					session = null;
					sessionRevision++;
				} finally {
					sessionBusy = false;
					publishState();
				}
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

				sessionBusy = true;
				publishState();
				try {
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
					messages = result.messages.map((message, index) => ({
						...message,
						id: message.id ?? `session-${result.session.id}-${index}`,
					}));
					session = result.session;
					sessionRevision++;
				} finally {
					sessionBusy = false;
					publishState();
				}
				return;
			}

			if (event.type === 'delete_session') {
				if (activeTurnId) {
					throw new Error(
						'Cannot delete session while a browser turn is active.',
					);
				}

				sessionBusy = true;
				publishState();
				try {
					// Clear the active session before deleting it so later autosaves
					// cannot recreate the deleted conversation.
					if (session?.id === event.sessionId) {
						await runtimeHandlers.resetSession();
						messages = [];
						session = null;
						sessionRevision++;
					}
					await runtimeHandlers.deleteSession(event.sessionId);
					broadcastEvent({
						type: 'sessions',
						id: event.id,
						sessions: await runtimeHandlers.listSessions(),
					});
				} finally {
					sessionBusy = false;
					publishState();
				}
				return;
			}

			if (activeTurnId) {
				throw new Error('Nanocoder is already processing a browser turn.');
			}

			activeTurnId = event.id;
			previousAssistantContent = '';
			assistantId = null;
			responseCounter = 0;
			messages.push({
				id: event.id,
				role: 'user',
				content: event.text,
				images: event.images,
			});
			publishState();

			try {
				const submission = runtimeHandlers.submitMessage(
					event.text,
					event.images,
				);
				void Promise.resolve(submission).then(
					() => completeActiveTurn(event.id),
					error => failActiveTurn(error, event.id),
				);
			} catch (error) {
				messages.pop();
				clearActiveTurn();
				publishState();
				throw error;
			}
		},

		bindRuntimeHandlers(handlers) {
			runtimeHandlers = handlers;

			return () => {
				if (runtimeHandlers === handlers) {
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
				assistantId = null;
				return;
			}

			if (!assistantId) {
				assistantId =
					responseCounter++ === 0
						? activeTurnId
						: `${activeTurnId}:response:${responseCounter}`;
				messages.push({id: assistantId, role: 'assistant', content: ''});
			}
			const extendsContent = content.startsWith(previousAssistantContent);
			const delta = extendsContent
				? content.slice(previousAssistantContent.length)
				: content;
			previousAssistantContent = content;
			const assistant = messages.find(
				message => message.role === 'assistant' && message.id === assistantId,
			);
			if (assistant) assistant.content = content;

			if (delta.length > 0) {
				broadcastEvent({
					type: extendsContent ? 'assistant_delta' : 'assistant_content',
					id: assistantId,
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

		getStateEvents() {
			return [
				stateEvent(),
				...(pendingInteraction ? [pendingInteraction.event] : []),
			];
		},

		requestApproval(request, signal) {
			if (!activeTurnId) {
				return Promise.resolve(false);
			}

			const id = nextInteractionId('approval');
			return new Promise<boolean>(resolve => {
				enqueueInteraction(
					{
						id,
						kind: 'approval',
						resolve,
						cleanup: () => {},
						event: {
							type: 'approval_required',
							id,
							toolName: request.toolName,
							arguments: sanitizeJsonRecord(request.arguments),
							...(request.context ? {context: request.context} : {}),
						},
					},
					signal,
				);
			});
		},

		requestQuestion(request, signal) {
			if (!activeTurnId) {
				return Promise.reject(
					new Error('No browser turn is active for this question.'),
				);
			}

			const id = nextInteractionId('question');
			return new Promise<string>((resolve, reject) => {
				enqueueInteraction(
					{
						id,
						kind: 'question',
						resolve,
						reject,
						cleanup: () => {},
						event: {
							type: 'question_required',
							id,
							question: request.question,
							options: [...request.options],
							allowFreeform: request.allowFreeform,
						},
					},
					signal,
				);
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
