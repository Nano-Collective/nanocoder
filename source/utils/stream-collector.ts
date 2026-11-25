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

export type StreamCollectorOptions = {
	/**
	 * Keep the most recent output instead of the oldest bytes past the cap:
	 * once the budget is exceeded, drop the head of the buffer and keep the
	 * tail, so a chatty dev server or watcher keeps producing readable output
	 * instead of freezing at the cap.
	 */
	keepLatest?: boolean;
	/**
	 * Called with the number of characters dropped from the front of the
	 * buffer when a `keepLatest` trim happens. The buffer's owner drops the
	 * same head from its accumulated output and moves its read cursor back over
	 * the dropped characters, so the next read starts where the retained tail
	 * begins.
	 */
	onTrim?: (droppedChars: number) => void;
};

/**
 * Bound how much of a child process's stream is held in memory.
 *
 * `collect` is a `data` listener that appends at most `BASH_MAX_OUTPUT_BYTES`
 * and then appends `marker` exactly once. Each collector owns its own budget,
 * so one stream's volume can never silently swallow the stderr that explains
 * why the command failed.
 *
 * With `keepLatest` (background jobs) the collector instead keeps the most
 * recent output: once the budget is exceeded it drops the head of the buffer
 * in whole characters and keeps the tail, so a chatty dev server or watcher
 * keeps producing readable output instead of freezing at the cap. The marker
 * is appended once, at the moment the first trim happens.
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
	options?: StreamCollectorOptions,
): StreamCollector {
	let bytes = 0;
	let truncated = false;
	let tail = '';
	let emitted = '';
	const decoder = new StringDecoder('utf8');

	const deliverText = (text: string): void => {
		if (!text) return;
		let next = tail + text;
		if (next.length > emitted.length) {
			append(next.slice(emitted.length));
			emitted = next;
		}
		if (Buffer.byteLength(next, 'utf8') > BASH_MAX_OUTPUT_BYTES) {
			// Drop whole characters from the front until the window fits the
			// cap. Dropping a byte count instead could split a multi-byte
			// character in half, so walk one character at a time and stop at a
			// boundary. Dropping once per chunk (instead of one character per
			// iteration) keeps a chunk that crosses the cap off the event loop.
			const overage = Buffer.byteLength(next, 'utf8') - BASH_MAX_OUTPUT_BYTES;
			let droppedBytes = 0;
			let droppedChars = 0;
			while (droppedBytes < overage) {
				const size = (next.codePointAt(droppedChars) ?? 1) > 0xffff ? 2 : 1;
				droppedBytes += size;
				droppedChars += size;
			}
			// The dropped head has already been delivered, so the emission
			// cursor shifts with it instead of keeping a stale offset that would
			// swallow or skip the output that follows.
			emitted = emitted.slice(droppedChars);
			next = next.slice(droppedChars);
			if (!truncated) {
				truncated = true;
				append(marker);
			}
			options?.onTrim?.(droppedChars);
		}
		tail = next;
		bytes = Buffer.byteLength(tail, 'utf8');
	};

	const deliver = (data: Buffer): void => {
		if (!options?.keepLatest) {
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
			return;
		}
		deliverText(decoder.write(data));
	};

	return {
		collect: data => {
			deliver(data);
		},
		flush: () => {
			const rest = decoder.end();
			if (!rest) return;
			if (!options?.keepLatest) {
				// On a truncated stream the held-back bytes are the leading half of
				// the character the cap cut in two. Emitting them would park a stray
				// U+FFFD after the marker, so they are dropped on purpose.
				if (truncated) return;
				append(rest);
				return;
			}
			deliverText(rest);
		},
	};
}
