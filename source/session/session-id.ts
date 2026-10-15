/**
 * UUID-shaped session ID validation shared by session and artifact storage.
 *
 * Lowercase only, matching `crypto.randomUUID()`. Both session files and
 * artifact directories are named after this value, so keeping the accepted
 * form narrow keeps a session id to exactly one on-disk spelling — on a
 * case-insensitive filesystem, accepting both cases would let two ids collide
 * on one directory.
 */
const SESSION_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isValidSessionId(id: string): boolean {
	return SESSION_ID_PATTERN.test(id);
}
