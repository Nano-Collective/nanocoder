import type {Session, SessionMetadata} from '@/session/session-manager';

function isRecord(obj: unknown): obj is Record<string, unknown> {
	return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

export function isValidSessionMetadata(obj: unknown): obj is SessionMetadata {
	if (!isRecord(obj)) return false;
	return (
		typeof obj.id === 'string' &&
		typeof obj.title === 'string' &&
		typeof obj.createdAt === 'string' &&
		typeof obj.lastAccessedAt === 'string' &&
		typeof obj.messageCount === 'number' &&
		typeof obj.provider === 'string' &&
		typeof obj.model === 'string' &&
		typeof obj.workingDirectory === 'string'
	);
}

export function isValidSession(obj: unknown): obj is Session {
	if (!isRecord(obj)) return false;
	return isValidSessionMetadata(obj) && Array.isArray(obj.messages);
}
