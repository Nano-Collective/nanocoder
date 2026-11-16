import {StringDecoder} from 'node:string_decoder';

import {BASH_MAX_OUTPUT_BYTES, BASH_MAX_OUTPUT_TAIL_BYTES} from '@/constants';

/** Builds the notice stamped between the kept head and the kept tail. */
export type TruncationNotice = (omittedBytes: number) => string;

export const stdoutTruncationNotice: TruncationNotice = omittedBytes =>
	`\n... [Output truncated: ${omittedBytes} bytes omitted to prevent memory exhaustion]\n`;

export const stderrTruncationNotice: TruncationNotice = omittedBytes =>
	`\n... [Stderr truncated: ${omittedBytes} bytes omitted to prevent memory exhaustion]\n`;

export type StreamCollector = {
	/** `data` listener for the stream. */
	collect: (data: Buffer) => void;
	/** Release the decoder's held-back bytes and the tail once the stream ends. */
	flush: () => void;
};

/**
 * The most recent `limit` bytes seen, with a count of everything dropped before
 * them. Chunks are kept as they arrived and only joined when the window is read,
 * so a flood costs no repeated copying per chunk.
 */
class RollingTail {
	private chunks: Buffer[] = [];
	private size = 0;
	private dropped = 0;

	constructor(private readonly limit: number) {}

	push(chunk: Buffer): void {
		this.chunks.push(chunk);
		this.size += chunk.length;

		// Drop whole chunks from the front while the window still holds a full
		// limit; the remainder is trimmed exactly when it is read.
		while (this.chunks.length > 1) {
			const head = this.chunks[0];
			if (head === undefined || this.size - head.length < this.limit) break;
			this.chunks.shift();
			this.size -= head.length;
			this.dropped += head.length;
		}
	}

	/** Decode the retained bytes, skipping a character the trim cut in two. */
	decode(): string {
		if (this.size === 0) return '';
		const joined = Buffer.concat(this.chunks, this.size);

		let start = joined.length > this.limit ? joined.length - this.limit : 0;
		while (start < joined.length) {
			const byte = joined[start];
			if (byte === undefined || (byte & 0xc0) !== 0x80) break;
			start++;
		}
		this.dropped += start;

		const retained = joined.subarray(start);
		if (retained.length === 0) return '';
		const decoder = new StringDecoder('utf8');
		return decoder.write(retained) + decoder.end();
	}

	/** Bytes this window dropped: trimmed off the front or skipped to a boundary. */
	get omittedBytes(): number {
		return this.dropped;
	}
}

function utf8SequenceLength(lead: number): number {
	if (lead < 0x80) return 1;
	if ((lead & 0xe0) === 0xc0) return 2;
	if ((lead & 0xf0) === 0xe0) return 3;
	if ((lead & 0xf8) === 0xf0) return 4;
	return 1;
}

/**
 * Length of the prefix of `buffer` that ends on a UTF-8 character boundary.
 * Only the final four bytes can be cut, so this never walks the whole buffer.
 */
function completeUtf8Length(buffer: Buffer): number {
	let lead = buffer.length - 1;
	let continuations = 0;
	while (lead >= 0 && continuations < 3) {
		const byte = buffer[lead];
		if (byte === undefined || (byte & 0xc0) !== 0x80) break;
		lead--;
		continuations++;
	}
	if (lead < 0) return buffer.length;

	const byte = buffer[lead];
	if (byte === undefined) return buffer.length;
	const expected = utf8SequenceLength(byte);
	return lead + expected <= buffer.length ? buffer.length : lead;
}

/**
 * Bound how much of a child process's stream is held in memory.
 *
 * `collect` is a `data` listener that appends the first `BASH_MAX_OUTPUT_BYTES`
 * immediately and rolls the most recent `BASH_MAX_OUTPUT_TAIL_BYTES` in a
 * second window. `flush` then appends one notice naming how many bytes fell
 * between them, followed by that tail.
 *
 * Keeping the tail matters as much as keeping the head: a command that prints
 * millions of progress lines still ends with its useful part (a test summary,
 * the assertion that failed), and a head-only cap dropped exactly that (#2237).
 * A later head-and-tail cut over this output then keeps the real ending.
 *
 * Each collector owns its own budget, so one stream's volume can't eat the
 * other's: a stdout flood can never silently swallow the stderr that explains
 * why the command failed.
 *
 * Chunks arrive split wherever the pipe happened to break, which can be
 * mid-character. Decoding each chunk on its own turns both halves of a
 * multi-byte sequence into U+FFFD, so the bytes run through a `StringDecoder`
 * that holds an incomplete tail back until the rest of it arrives. Call
 * `flush` once the stream is done to emit whatever is still held.
 */
export function makeStreamCollector(
	append: (text: string) => void,
	notice: TruncationNotice,
): StreamCollector {
	const decoder = new StringDecoder('utf8');
	const tail = new RollingTail(BASH_MAX_OUTPUT_TAIL_BYTES);
	/** Bytes the head decoder has consumed. */
	let headBytes = 0;
	let spilled = false;
	let flushed = false;

	return {
		collect: (data: Buffer) => {
			if (flushed) return;

			let rest = data;
			if (!spilled && headBytes < BASH_MAX_OUTPUT_BYTES) {
				let take = Math.min(BASH_MAX_OUTPUT_BYTES - headBytes, rest.length);
				if (headBytes + take === BASH_MAX_OUTPUT_BYTES) {
					// Stop the head on a character boundary. A half-written
					// character left inside the decoder would be dropped when the
					// tail takes over, losing bytes that no notice accounted for.
					take = completeUtf8Length(rest.subarray(0, take));
				}
				const text = decoder.write(rest.subarray(0, take));
				if (text) append(text);
				headBytes += take;
				rest = rest.subarray(take);
			}

			if (rest.length > 0) {
				spilled = true;
				tail.push(rest);
			}
		},
		flush: () => {
			if (flushed) return;
			flushed = true;

			if (!spilled) {
				const rest = decoder.end();
				if (rest) append(rest);
				return;
			}

			// The head stops on a character boundary, so everything the stream
			// sent after it reached the tail and the only missing bytes are the
			// ones its window rolled off.
			const text = tail.decode();
			const omitted = tail.omittedBytes;
			// Nothing between the windows: head and tail reproduce the stream, so a
			// notice would only corrupt it.
			if (omitted > 0) append(notice(omitted));
			if (text) append(text);
		},
	};
}
