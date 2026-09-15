import {BASH_MAX_OUTPUT_BYTES} from '@/constants';

export const STDOUT_TRUNCATION_NOTICE =
	'\n... [Output truncated to prevent memory exhaustion]';
export const STDERR_TRUNCATION_NOTICE =
	'\n... [Stderr truncated to prevent memory exhaustion]';

/**
 * Bound how much of a child process's stream is held in memory.
 *
 * Returns a `data` listener that appends at most `BASH_MAX_OUTPUT_BYTES` and
 * then appends `marker` exactly once. Each collector owns its own budget, so
 * one stream's volume can't eat the other's: a stdout flood can never silently
 * swallow the stderr that explains why the command failed.
 *
 * The marker is appended inline rather than tracked as a flag so it rides at
 * the end of its own section and survives a later tail-keeping truncation.
 */
export function makeStreamCollector(
	append: (text: string) => void,
	marker: string,
) {
	let bytes = 0;
	let truncated = false;
	return (data: Buffer) => {
		if (bytes < BASH_MAX_OUTPUT_BYTES) {
			const remaining = BASH_MAX_OUTPUT_BYTES - bytes;
			const limitedChunk = data.subarray(0, remaining);
			append(limitedChunk.toString());
			bytes += limitedChunk.length;
		}
		if (bytes >= BASH_MAX_OUTPUT_BYTES && !truncated) {
			truncated = true;
			append(marker);
		}
	};
}
