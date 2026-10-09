// Backoff for the HTTP layer. Unrelated to the request timeout.
export const RETRY_BACKOFF_MS = 3000;

export function nextDelay(attempt) {
	return RETRY_BACKOFF_MS * 2 ** attempt;
}
