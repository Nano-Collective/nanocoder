let activeSessionId: string | null = null;

export function setCliSessionId(sessionId: string | null): void {
	activeSessionId = sessionId;
}

export function getCliSessionId(): string | null {
	return activeSessionId;
}
