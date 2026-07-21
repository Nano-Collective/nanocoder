import type {WebClientEvent, WebServerEvent} from './protocol.js';

export interface WebRuntimeHandlers {
	submitMessage: (text: string) => void | Promise<void>;
	cancel: () => void;
}

export interface WebRuntimeBridge {
	handleClientEvent: (event: WebClientEvent) => Promise<void>;
	bindRuntimeHandlers: (handlers: WebRuntimeHandlers) => () => void;
	publishAssistantContent: (content: string) => void;
	completeTurn: () => void;
	failTurn: (error: unknown) => void;
}

export function createWebRuntimeBridge(
	broadcastEvent: (event: WebServerEvent) => void,
): WebRuntimeBridge {
	let runtimeHandlers: WebRuntimeHandlers | null = null;
	let activeTurnId: string | null = null;
	let previousAssistantContent = '';

	const clearActiveTurn = () => {
		activeTurnId = null;
		previousAssistantContent = '';
	};

	const completeActiveTurn = (expectedTurnId?: string) => {
		if (!activeTurnId || (expectedTurnId && activeTurnId !== expectedTurnId)) {
			return;
		}

		broadcastEvent({type: 'turn_completed', id: activeTurnId});
		clearActiveTurn();
	};

	const failActiveTurn = (error: unknown, expectedTurnId?: string) => {
		if (!activeTurnId || (expectedTurnId && activeTurnId !== expectedTurnId)) {
			return;
		}

		broadcastEvent({
			type: 'error',
			message:
				error instanceof Error
					? error.message
					: 'Nanocoder could not complete this turn.',
		});
		clearActiveTurn();
	};

	return {
		async handleClientEvent(event) {
			if (event.type === 'hello') {
				return;
			}

			if (!runtimeHandlers) {
				throw new Error('Nanocoder runtime is still starting.');
			}

			if (event.type === 'cancel') {
				if (!activeTurnId || event.id !== activeTurnId) {
					throw new Error('This browser turn is no longer active.');
				}

				runtimeHandlers.cancel();
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

		completeTurn() {
			completeActiveTurn();
		},

		failTurn(error) {
			failActiveTurn(error);
		},
	};
}
