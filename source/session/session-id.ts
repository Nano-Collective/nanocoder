/** UUID-shaped session ID validation shared by session and artifact storage. */
const SESSION_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSessionId(id: string): boolean {
	return SESSION_ID_PATTERN.test(id);
}
