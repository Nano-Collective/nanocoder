export interface RealtimeSessionOptions {
	model?: string;
	voice?: string;
	signal?: AbortSignal;
	onAudioDelta?: (chunk: Buffer | Uint8Array) => void;
	onTranscriptDelta?: (text: string) => void;
	onError?: (error: Error) => void;
	onClose?: () => void;
}

export interface RealtimeSession {
	sessionId: string;
	sendAudioChunk(chunk: Buffer | Uint8Array): Promise<void>;
	sendTextMessage(text: string): Promise<void>;
	interrupt(): Promise<void>;
	close(): Promise<void>;
	isOpen(): boolean;
}

export interface RealtimeCapability {
	supportsRealtimeAudio: true;
	openRealtimeSession(
		options?: RealtimeSessionOptions,
	): Promise<RealtimeSession>;
}

export function isRealtimeCapable(
	client: unknown,
): client is RealtimeCapability {
	return (
		typeof client === 'object' &&
		client !== null &&
		'supportsRealtimeAudio' in client &&
		(client as RealtimeCapability).supportsRealtimeAudio === true &&
		typeof (client as RealtimeCapability).openRealtimeSession === 'function'
	);
}
