import {StringDecoder} from 'node:string_decoder';

import {BASH_MAX_OUTPUT_BYTES} from '@/constants';

export const STDOUT_TRUNCATION_NOTICE =
	'\n... [Output truncated to prevent memory exhaustion]';
export const STDERR_TRUNCATION_NOTICE =
	'\n... [Stderr truncated to prevent memory exhaustion]';

export type StreamCollector = {
	/** `data` listener for the stream. */
	collect: (data: Buffer) => void;
	/** Release the decoder's held-back bytes once the stream is finished. */
	flush: () => void;
};

/**
 * Bound how much of a child process's stream is held in memory.
 *
 * `collect` is a `data` listener that appends at most `BASH_MAX_OUTPUT_BYTES`
 * and then appends `marker` exactly once. Each collector owns its own budget,
 * so one stream's volume can't eat the other's: a stdout flood can never
 * silently swallow the stderr that explains why the command failed.
 *
 * The marker is appended inline rather than tracked as a flag so it rides at
 * the end of its own section and survives a later tail-keeping truncation.
 *
 * Chunks arrive split wherever the pipe happened to break, which can be
 * mid-character. Decoding each chunk on its own turns both halves of a
 * multi-byte sequence into U+FFFD, so the bytes run through a `StringDecoder`
 * that holds an incomplete tail back until the rest of it arrives. Call
 * `flush` once the stream is done to emit whatever is still held.
 */
export function makeStreamCollector(
	append: (text: string) => void,
	marker: string,
): StreamCollector {
	let bytes = 0;
	let truncated = false;
	const decoder = new StringDecoder('utf8');

	return {
		collect: (data: Buffer) => {
			if (bytes < BASH_MAX_OUTPUT_BYTES) {
				const remaining = BASH_MAX_OUTPUT_BYTES - bytes;
				const limitedChunk = data.subarray(0, remaining);
				append(decoder.write(limitedChunk));
				bytes += limitedChunk.length;
			}
			if (bytes >= BASH_MAX_OUTPUT_BYTES && !truncated) {
				truncated = true;
				append(marker);
			}
		},
		flush: () => {
			// On a truncated stream the held-back bytes are the leading half of
			// the character the cap cut in two. Emitting them would park a stray
			// U+FFFD after the marker, so they are dropped on purpose.
			if (truncated) return;
			const rest = decoder.end();
			if (rest) append(rest);
		},
	};
}
