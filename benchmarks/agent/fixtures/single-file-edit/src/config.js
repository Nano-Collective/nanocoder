// Runtime configuration for the request layer.
export const DEFAULT_TIMEOUT_MS = 3000;
export const MAX_RETRIES = 2;

export function describeConfig() {
	return `timeout=${DEFAULT_TIMEOUT_MS}ms retries=${MAX_RETRIES}`;
}
