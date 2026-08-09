export const WEB_PROTOCOL_VERSION = 1;

export type WebClientEvent =
	| {type: 'hello'; protocolVersion: typeof WEB_PROTOCOL_VERSION}
	| {type: 'user_message'; id: string; text: string}
	| {type: 'cancel'; id: string}
	| {type: 'approval_response'; id: string; approved: boolean}
	| {type: 'question_response'; id: string; answer: string}
	| {type: 'reset_session'; id: string};

export type WebServerEvent =
	| {type: 'ready'; protocolVersion: typeof WEB_PROTOCOL_VERSION}
	| {type: 'ack'; id: string}
	| {type: 'assistant_delta'; id: string; text: string}
	| {type: 'tool_started'; id: string; name: string}
	| {type: 'tool_finished'; id: string; name: string; ok: boolean}
	| {
			type: 'approval_required';
			id: string;
			toolName: string;
			arguments: Record<string, unknown>;
			context?: string;
	  }
	| {
			type: 'question_required';
			id: string;
			question: string;
			options: string[];
			allowFreeform: boolean;
	  }
	| {type: 'turn_completed'; id: string}
	| {type: 'error'; message: string; id?: string};

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

			return {
				type: 'user_message',
				id: parsed.id,
				text: parsed.text,
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
