export const WEB_PROTOCOL_VERSION = 1;

export interface WebSessionSummary {
	id: string;
	title: string;
	lastAccessedAt: string;
	messageCount: number;
}

export interface WebSessionMessage {
	id?: string;
	role: 'user' | 'assistant';
	content: string;
	images?: {data: string; mediaType: string}[];
	createdAt?: string;
	/** Only the final assistant reply of a finished turn has a footer. */
	footerVisible?: boolean;
}

export interface WebSettings {
	provider: string;
	model: string;
	mode: string;
	providers: {name: string; models: string[]}[];
	modes: string[];
}

export interface WebNotice {
	role: string;
	text: string;
	metaText?: string;
}

export interface WebWorkSummary {
	id: string;
	status: 'working' | 'completed' | 'failed';
	startedAt: number;
	reasoning: {id: string; text: string}[];
	tools: {
		id: string;
		name: string;
		status: 'running' | 'completed' | 'failed';
		arguments?: Record<string, unknown>;
		output?: string;
	}[];
}

export type WebClientEvent =
	| {type: 'hello'; protocolVersion: typeof WEB_PROTOCOL_VERSION}
	| {
			type: 'user_message';
			id: string;
			text: string;
			images?: {data: string; mediaType: string}[];
	  }
	| {type: 'cancel'; id: string}
	| {type: 'approval_response'; id: string; approved: boolean}
	| {type: 'question_response'; id: string; answer: string}
	| {type: 'reset_session'; id: string}
	| {type: 'list_sessions'; id: string}
	| {type: 'load_session'; id: string; sessionId: string}
	| {type: 'delete_session'; id: string; sessionId: string}
	| {
			type: 'update_settings';
			id: string;
			provider: string;
			model: string;
			mode: string;
	  };

export type WebServerEvent =
	| {
			type: 'state';
			activeTurnId: string | null;
			messages: WebSessionMessage[];
			session: WebSessionSummary | null;
			busy: boolean;
			sessionRevision: number;
			runtimeReady: boolean;
			runtimeStatus: string;
			settings: WebSettings | null;
			notices: WebNotice[];
			work?: WebWorkSummary[];
	  }
	| {type: 'interaction_closed'; id: string}
	| {type: 'ready'; protocolVersion: typeof WEB_PROTOCOL_VERSION}
	| {type: 'ack'; id: string}
	| {type: 'assistant_delta'; id: string; text: string}
	| {type: 'assistant_content'; id: string; text: string}
	| {type: 'work_update'; work: WebWorkSummary}
	| {
			type: 'tool_started';
			id: string;
			name: string;
			arguments?: Record<string, unknown>;
	  }
	| {
			type: 'tool_finished';
			id: string;
			name: string;
			ok: boolean;
			output?: string;
	  }
	| {
			type: 'approval_required';
			id: string;
			toolName: string;
			arguments: Record<string, unknown>;
			context?: string;
			toolCallId?: string;
	  }
	| {
			type: 'question_required';
			id: string;
			question: string;
			options: string[];
			allowFreeform: boolean;
	  }
	| {type: 'turn_completed'; id: string}
	| {type: 'error'; message: string; id?: string}
	| {type: 'notice'; message: string}
	| {type: 'sessions'; id: string; sessions: WebSessionSummary[]}
	| {
			type: 'session_loaded';
			id: string;
			session: WebSessionSummary;
			messages: WebSessionMessage[];
	  };

export function parseWebClientEvent(rawMessage: string): WebClientEvent {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawMessage);
	} catch {
		throw new Error('Invalid JSON message.');
	}

	if (!isRecord(parsed) || typeof parsed.type !== 'string') {
		throw new Error('Invalid web event.');
	}

	switch (parsed.type) {
		case 'hello':
			if (parsed.protocolVersion !== WEB_PROTOCOL_VERSION) {
				throw new Error('Unsupported web protocol version.');
			}

			return {
				type: 'hello',
				protocolVersion: WEB_PROTOCOL_VERSION,
			};
		case 'user_message':
			if (typeof parsed.id !== 'string' || parsed.id.length === 0) {
				throw new Error('User message id is required.');
			}

			if (typeof parsed.text !== 'string') {
				throw new Error('User message text is required.');
			}

			if (
				parsed.images !== undefined &&
				(!Array.isArray(parsed.images) ||
					!parsed.images.every(
						(img: unknown) =>
							isRecord(img) &&
							typeof img.data === 'string' &&
							typeof img.mediaType === 'string',
					))
			) {
				throw new Error(
					'User message images must be an array of image objects.',
				);
			}

			return {
				type: 'user_message',
				id: parsed.id,
				text: parsed.text,
				images: (
					parsed.images as {data: string; mediaType: string}[] | undefined
				)?.map(image => ({
					...image,
					data: image.data.startsWith('data:')
						? image.data.slice(image.data.indexOf(',') + 1)
						: image.data,
				})),
			};
		case 'cancel':
			if (typeof parsed.id !== 'string' || parsed.id.length === 0) {
				throw new Error('Cancel id is required.');
			}

			return {
				type: 'cancel',
				id: parsed.id,
			};
		case 'approval_response':
			if (typeof parsed.id !== 'string' || parsed.id.length === 0) {
				throw new Error('Approval response id is required.');
			}

			if (typeof parsed.approved !== 'boolean') {
				throw new Error('Approval response approved flag is required.');
			}

			return {
				type: 'approval_response',
				id: parsed.id,
				approved: parsed.approved,
			};
		case 'question_response':
			if (typeof parsed.id !== 'string' || parsed.id.length === 0) {
				throw new Error('Question response id is required.');
			}

			if (typeof parsed.answer !== 'string') {
				throw new Error('Question response answer is required.');
			}

			return {
				type: 'question_response',
				id: parsed.id,
				answer: parsed.answer,
			};
		case 'reset_session':
			if (typeof parsed.id !== 'string' || parsed.id.length === 0) {
				throw new Error('Reset session id is required.');
			}

			return {
				type: 'reset_session',
				id: parsed.id,
			};
		case 'list_sessions':
			if (typeof parsed.id !== 'string' || parsed.id.length === 0) {
				throw new Error('List sessions id is required.');
			}

			return {
				type: 'list_sessions',
				id: parsed.id,
			};
		case 'load_session':
			if (typeof parsed.id !== 'string' || parsed.id.length === 0) {
				throw new Error('Load session id is required.');
			}

			if (
				typeof parsed.sessionId !== 'string' ||
				parsed.sessionId.length === 0
			) {
				throw new Error('Load session sessionId is required.');
			}

			return {
				type: 'load_session',
				id: parsed.id,
				sessionId: parsed.sessionId,
			};
		case 'delete_session':
			if (typeof parsed.id !== 'string' || parsed.id.length === 0) {
				throw new Error('Delete session id is required.');
			}

			if (
				typeof parsed.sessionId !== 'string' ||
				parsed.sessionId.length === 0
			) {
				throw new Error('Delete session sessionId is required.');
			}

			return {
				type: 'delete_session',
				id: parsed.id,
				sessionId: parsed.sessionId,
			};
		case 'update_settings':
			if (
				typeof parsed.id !== 'string' ||
				!parsed.id ||
				typeof parsed.provider !== 'string' ||
				!parsed.provider ||
				typeof parsed.model !== 'string' ||
				!parsed.model ||
				typeof parsed.mode !== 'string' ||
				!parsed.mode
			)
				throw new Error('Settings id, provider, model and mode are required.');
			return {
				type: 'update_settings',
				id: parsed.id,
				provider: parsed.provider,
				model: parsed.model,
				mode: parsed.mode,
			};
		default:
			throw new Error(`Unsupported web event type: ${parsed.type}.`);
	}
}

export function serializeWebServerEvent(event: WebServerEvent): string {
	return JSON.stringify(event);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
