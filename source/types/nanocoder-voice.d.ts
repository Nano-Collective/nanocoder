export function playPhrase(text: string): Promise<void>;
export function recordAudio(
	filePath: string,
	durationMs?: number,
	signal?: AbortSignal,
): Promise<void>;
export function playAudio(
	filePath: string,
	timeoutMs?: number,
	signal?: AbortSignal,
): Promise<void>;
export function transcribeAudio(
	filePath: string,
	timeoutMs?: number,
	signal?: AbortSignal,
): Promise<string>;
export function synthesizeSpeech(
	text: string,
	outputPath: string,
	timeoutMs?: number,
	signal?: AbortSignal,
): Promise<void>;
