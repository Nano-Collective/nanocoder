import type {
	WebClientEvent,
	WebNotice,
	WebPanel,
	WebPanelData,
	WebServerEvent,
	WebSessionMessage,
	WebSessionSummary,
	WebSettings,
	WebWorkSummary,
} from './protocol.js';

export interface WebSessionLoadResult {
	session: WebSessionSummary;
	messages: WebSessionMessage[];
}

export interface WebRuntimeHandlers {
	getWorkspacePanel?: (panel: WebPanel, path?: string) => Promise<WebPanelData>;
	submitMessage: (
		text: string,
		images?: {data: string; mediaType: string}[],
	) => void | Promise<void>;
	cancel: () => void;
	resetSession: () => void | Promise<void>;
	listSessions: () => Promise<WebSessionSummary[]>;
	loadSession: (sessionId: string) => Promise<WebSessionLoadResult | null>;
	deleteSession: (sessionId: string) => Promise<void>;
	getSessionState?: () => {
		session: WebSessionSummary | null;
		messages: WebSessionMessage[];
	};
	updateSettings?: (settings: {
		provider: string;
		model: string;
		mode: string;
	}) => Promise<void>;
}

export interface WebApprovalRequest {
	toolCallId?: string;
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
	publishAssistantContent: (content: string, newResponse?: boolean) => void;
	publishReasoning: (content: string) => void;
	publishToolStarted: (
		id: string,
		name: string,
		arguments_?: Record<string, unknown>,
	) => void;
	publishToolFinished: (
		id: string,
		name: string,
		ok: boolean,
		output?: string,
	) => void;
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
	syncSession: (
		session: WebSessionSummary | null,
		messages: WebSessionMessage[],
	) => void;
	setRuntimeStatus: (status: string) => void;
	setSettings: (settings: WebSettings) => void;
	publishNotice: (message: string) => void;
	refreshSessions: () => Promise<void>;
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
	let runtimeStatus = 'Nanocoder runtime is still starting.';
	let settings: WebSettings | null = null;
	let notices: WebNotice[] = [];
	let work: WebWorkSummary[] = [];
	let reasoningId: string | null = null;
	let reasoningCounter = 0;
	let sessionListRevision = 0;
	const publishSessionList = async (id: string) => {
		const handlers = runtimeHandlers;
		if (!handlers) return;
		const revision = ++sessionListRevision;
		const sessions = await handlers.listSessions();
		if (revision === sessionListRevision && runtimeHandlers === handlers)
			broadcastEvent({type: 'sessions', id, sessions});
	};
	const currentWork = () => {
		let summary = work.find(item => item.id === activeTurnId);
		if (!summary && activeTurnId) {
			summary = {
				id: activeTurnId,
				status: 'working',
				startedAt: Date.now(),
				reasoning: [],
				tools: [],
			};
			work.push(summary);
		}
		return summary;
	};
	const stateEvent = (): WebServerEvent => ({
		type: 'state',
		activeTurnId,
		messages: structuredClone(messages),
		session,
		busy: sessionBusy,
		sessionRevision,
		runtimeReady: runtimeHandlers !== null,
		runtimeStatus,
		settings,
		notices: structuredClone(notices),
		work: structuredClone(work),
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
	const finishAssistantReply = () => {
		const reply = [...messages]
			.reverse()
			.find(
				message =>
					message.role === 'assistant' &&
					message.content.trim() &&
					(message.id === activeTurnId ||
						message.id?.startsWith(`${activeTurnId}:response:`)),
			);
		if (reply) {
			reply.footerVisible = true;
			reply.createdAt = new Date().toISOString();
		}
	};
	const isFinalReply = (history: WebSessionMessage[], index: number) => {
		for (const message of history.slice(index + 1)) {
			if (message.role === 'user') break;
			if (message.role === 'assistant' && message.content.trim()) return false;
		}
		return (
			history[index].role === 'assistant' && !!history[index].content.trim()
		);
	};
	const syncSession = (
		nextSession: WebSessionSummary | null,
		nextMessages: WebSessionMessage[],
	) => {
		const changedSession = session?.id !== nextSession?.id;
		session = nextSession;
		if (!activeTurnId) {
			if (
				changedSession ||
				(messages.length > 0 && nextMessages.length === 0)
			) {
				sessionRevision++;
				notices = [];
				work = [];
			}
			const previousMessages = messages;
			const used = new Set<WebSessionMessage>();
			messages = nextMessages.map((message, index) => {
				const previous = !changedSession
					? previousMessages.find(
							previous =>
								!used.has(previous) &&
								previous.role === message.role &&
								(previous.content === message.content ||
									(message.role === 'assistant' &&
										(previous.content.startsWith(message.content) ||
											message.content.startsWith(previous.content)))),
						)
					: undefined;
				if (previous) used.add(previous);
				return {
					...message,
					footerVisible:
						message.footerVisible ??
						previous?.footerVisible ??
						isFinalReply(nextMessages, index),
					createdAt: message.createdAt ?? previous?.createdAt,
					content:
						previous &&
						message.role === 'assistant' &&
						previous.content.startsWith(message.content)
							? previous.content
							: message.content,
					id:
						message.id ??
						previous?.id ??
						`session-${nextSession?.id ?? 'new'}-${index}`,
				};
			});
			if (!changedSession && nextMessages.length > 0) {
				const lastMatchedIndex = Math.max(
					-1,
					...[...used].map(message => previousMessages.indexOf(message)),
				);
				for (const previous of previousMessages.slice(lastMatchedIndex + 1)) {
					if (previous.role === 'assistant' && !used.has(previous))
						messages.push(previous);
				}
			}
		}
	};
	const refreshSession = () => {
		const snapshot = runtimeHandlers?.getSessionState?.();
		if (snapshot) syncSession(snapshot.session, snapshot.messages);
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
		finishAssistantReply();
		const summary = currentWork();
		if (summary) summary.status = 'completed';
		const isLocalAction =
			activeTurnId &&
			!messages.some(
				message => message.role === 'user' && message.id === activeTurnId,
			);
		clearActiveTurn();
		// React commits its history asynchronously. The live transcript already
		// contains the final token; don't replace it with an older render here.
		if (isLocalAction) refreshSession();
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
		const message =
			error instanceof Error
				? error.message
				: 'Nanocoder could not complete this turn.';
		broadcastEvent({
			type: 'error',
			id: activeTurnId,
			message,
		});
		const summary = currentWork();
		if (summary) summary.status = 'failed';
		clearActiveTurn();
		refreshSession();
		notices.push({role: 'system error', text: message});
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
				throw new Error(runtimeStatus);
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
			if (event.type === 'workspace_panel') {
				if (!runtimeHandlers.getWorkspacePanel)
					throw new Error('Workspace panels are unavailable.');
				const data = await runtimeHandlers.getWorkspacePanel(
					event.panel,
					event.path,
				);
				broadcastEvent({type: 'workspace_panel', id: event.id, data});
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
					notices = [];
					work = [];
					sessionRevision++;
				} finally {
					sessionBusy = false;
					publishState();
				}
				return;
			}

			if (event.type === 'update_settings') {
				if (activeTurnId)
					throw new Error(
						'Finish or cancel the current turn before changing settings.',
					);
				if (!runtimeHandlers.updateSettings)
					throw new Error('Runtime settings are unavailable.');
				sessionBusy = true;
				publishState();
				try {
					await runtimeHandlers.updateSettings(event);
				} finally {
					sessionBusy = false;
					publishState();
				}
				return;
			}

			if (event.type === 'list_sessions') {
				await publishSessionList(event.id);
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
						footerVisible: isFinalReply(result.messages, index),
						id: message.id ?? `session-${result.session.id}-${index}`,
					}));
					session = result.session;
					notices = [];
					work = [];
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
					refreshSession();
					if (session?.id === event.sessionId) {
						await runtimeHandlers.resetSession();
						messages = [];
						session = null;
						notices = [];
						work = [];
						sessionRevision++;
					}
					await runtimeHandlers.deleteSession(event.sessionId);
					await publishSessionList(event.id);
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
			reasoningId = null;
			reasoningCounter = 0;
			const isLocalAction =
				event.text.trim().startsWith('/') || event.text.trim().startsWith('!');
			if (!isLocalAction)
				messages.push({
					id: event.id,
					role: 'user',
					content: event.text,
					images: event.images,
					createdAt: new Date().toISOString(),
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
				if (!isLocalAction) messages.pop();
				clearActiveTurn();
				publishState();
				throw error;
			}
		},

		bindRuntimeHandlers(handlers) {
			runtimeHandlers = handlers;
			refreshSession();
			publishState();

			return () => {
				if (runtimeHandlers === handlers) {
					runtimeHandlers = null;
					publishState();
				}
			};
		},

		syncSession(nextSession, nextMessages) {
			const previousSession = session;
			syncSession(nextSession, nextMessages);
			// Token delivery uses deltas. History commits during an active turn
			// must not force full DOM/markdown work on every model step.
			if (
				!activeTurnId ||
				previousSession?.id !== session?.id ||
				previousSession?.title !== session?.title
			)
				publishState();
		},
		setRuntimeStatus(status) {
			if (runtimeStatus === status) return;
			runtimeStatus = status;
			publishState();
		},
		setSettings(next) {
			settings = next;
			publishState();
		},
		publishNotice(message) {
			notices.push({role: 'system', text: message, metaText: 'Local UI'});
			broadcastEvent({type: 'notice', message});
		},
		refreshSessions() {
			return publishSessionList('runtime-session-refresh');
		},

		publishAssistantContent(content, newResponse = false) {
			if (!activeTurnId) {
				return;
			}

			if (newResponse) {
				previousAssistantContent = '';
				assistantId = null;
				return;
			}
			if (!content && !assistantId) return;

			if (!assistantId) {
				assistantId =
					responseCounter++ === 0
						? activeTurnId
						: `${activeTurnId}:response:${responseCounter}`;
				messages.push({
					id: assistantId,
					role: 'assistant',
					content: '',
					createdAt: new Date().toISOString(),
					footerVisible: false,
				});
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
			if (!content)
				messages = messages.filter(message => message !== assistant);

			if (delta.length > 0 || !extendsContent) {
				broadcastEvent({
					type: extendsContent ? 'assistant_delta' : 'assistant_content',
					id: assistantId,
					text: delta,
				});
			}
			if (!content) assistantId = null;
		},
		publishReasoning(content) {
			if (!activeTurnId) return;
			if (!content) {
				reasoningId = null;
				return;
			}
			const summary = currentWork();
			if (!summary) return;
			if (!reasoningId) {
				reasoningId = `${activeTurnId}:thought:${++reasoningCounter}`;
				summary.reasoning.push({id: reasoningId, text: ''});
			}
			const thought = summary.reasoning.find(item => item.id === reasoningId);
			if (thought) thought.text = content;
			broadcastEvent({type: 'work_update', work: structuredClone(summary)});
		},

		publishToolStarted(id, name, arguments_) {
			if (!activeTurnId) {
				return;
			}

			const summary = currentWork();
			summary?.tools.push({id, name, status: 'running', arguments: arguments_});
			broadcastEvent({
				type: 'tool_started',
				id,
				name,
				...(arguments_ ? {arguments: arguments_} : {}),
			});
		},

		publishToolFinished(id, name, ok, output) {
			if (!activeTurnId) {
				return;
			}

			const summary = currentWork();
			const tool = summary?.tools.find(tool => tool.id === id);
			if (tool) {
				tool.status = ok ? 'completed' : 'failed';
				tool.output = output?.slice(0, 12000);
			} else
				summary?.tools.push({
					id,
					name,
					status: ok ? 'completed' : 'failed',
					output: output?.slice(0, 12000),
				});
			broadcastEvent({
				type: 'tool_finished',
				id,
				name,
				ok,
				...(output ? {output: output.slice(0, 12000)} : {}),
			});
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
							...(request.toolCallId ? {toolCallId: request.toolCallId} : {}),
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
