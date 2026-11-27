import {StringDecoder} from 'node:string_decoder';

import {BASH_MAX_OUTPUT_BYTES, BASH_MAX_OUTPUT_TAIL_BYTES} from '@/constants';

/** Builds the notice stamped between the kept head and the kept tail. */
export type TruncationNotice = (
	omittedBytes: number,
	totalBytes: number,
) => string;

export const stdoutTruncationNotice: TruncationNotice = (
	omittedBytes,
	totalBytes,
) =>
	`\n... [Output truncated: ${omittedBytes} bytes omitted of ${totalBytes} total to prevent memory exhaustion]\n`;

export const stderrTruncationNotice: TruncationNotice = (
	omittedBytes,
	totalBytes,
) =>
	`\n... [Stderr truncated: ${omittedBytes} bytes omitted of ${totalBytes} total to prevent memory exhaustion]\n`;

/** Static markers for the rolling keep-latest path (background jobs). */
export const STDOUT_TRUNCATION_NOTICE =
	'\n... [Output truncated to prevent memory exhaustion]';
export const STDERR_TRUNCATION_NOTICE =
	'\n... [Stderr truncated to prevent memory exhaustion]';

export type StreamCollector = {
	/** `data` listener for the stream. */
	collect: (data: Buffer) => void;
	/** Release the decoder's held-back bytes and the tail once the stream ends. */
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
 * Largest prefix of `buffer` that ends on a UTF-8 character boundary. Invalid
 * sequences count as one byte, which is how the decoder emits them (U+FFFD).
 * A chunk is scanned once; held bytes are at most three, so the total work is
 * linear in the bytes written.
 */
function completeUtf8Prefix(buffer: Buffer): number {
	let index = 0;
	while (index < buffer.length) {
		const lead = buffer[index];
		if (lead === undefined) break;
		const length = utf8SequenceLength(lead);
		if (index + length > buffer.length) break;
		let valid = true;
		for (let offset = 1; offset < length; offset++) {
			const continuation = buffer[index + offset];
			if (continuation === undefined || (continuation & 0xc0) !== 0x80) {
				valid = false;
				break;
			}
		}
		index += valid ? length : 1;
	}
	return index;
}

/**
 * Bound how much of a child process's stream is held in memory.
 *
 * Foreground commands (`collect` without `keepLatest`) append the first
 * `BASH_MAX_OUTPUT_BYTES` immediately and roll the most recent
 * `BASH_MAX_OUTPUT_TAIL_BYTES` in a second window. `flush` then appends one
 * notice naming how many bytes fell between them, followed by that tail.
 * Keeping the tail matters as much as the head: a command that prints millions
 * of progress lines still ends with its useful part (a test summary, the
 * assertion that failed), and a head-only cap dropped exactly that (#2237).
 *
 * Background jobs pass `keepLatest` (and `onTrim`) so their collector instead
 * keeps a rolling latest-`BASH_MAX_OUTPUT_BYTES` window that `bash_output`
 * reads incrementally. They stay latest-only: a long-running watcher is about
 * what just happened, not the command's beginning. The marker is appended
 * inline at the first trim, where it survives later trims and reads.
 *
 * Each collector owns its own budget, so one stream's volume can't eat the
 * other's: a stdout flood can never silently swallow the stderr that explains
 * why the command failed.
 *
 * Chunks arrive split wherever the pipe happened to break, which can be
 * mid-character. Decoding each chunk on its own turns both halves of a
 * multi-byte sequence into U+FFFD, so incomplete trailing bytes are held until
 * the rest arrives, or moved whole to the tail when the head cap is reached.
 * `flush` releases anything still held.
 */
export function makeStreamCollector(
	append: (text: string) => void,
	notice: TruncationNotice | string,
	options?: StreamCollectorOptions,
): StreamCollector {
	return options?.keepLatest
		? makeKeepLatestCollector(append, notice, options)
		: makeHeadTailCollector(append, notice);
}

function makeHeadTailCollector(
	append: (text: string) => void,
	notice: TruncationNotice | string,
): StreamCollector {
	const emitNotice: TruncationNotice =
		typeof notice === 'string' ? () => notice : notice;
	const tail = new RollingTail(BASH_MAX_OUTPUT_TAIL_BYTES);
	/** Bytes the head has already decoded into `append`. */
	let headBytes = 0;
	/** Trailing bytes awaiting the rest of a multi-byte character. */
	let headHeld: Buffer = Buffer.alloc(0);
	let spilled = false;
	let flushed = false;
	/** Every byte the stream sent, including those the windows dropped. */
	let totalBytes = 0;

	return {
		collect: (data: Buffer) => {
			if (flushed) return;
			totalBytes += data.length;

			let rest = data;
			if (!spilled && headBytes < BASH_MAX_OUTPUT_BYTES) {
				const take = Math.min(BASH_MAX_OUTPUT_BYTES - headBytes, rest.length);
				const combined =
					headHeld.length > 0
						? Buffer.concat([headHeld, rest.subarray(0, take)])
						: rest.subarray(0, take);
				const boundary = completeUtf8Prefix(combined);
				if (boundary > 0) {
					append(combined.subarray(0, boundary).toString('utf8'));
					headBytes += boundary;
				}

				if (take < rest.length) {
					// The cap stopped the head. An incomplete character belongs to
					// the tail whole: skipping a lead byte here would leave an
					// orphaned continuation in the decoder and leak U+FFFD.
					rest = Buffer.concat([
						combined.subarray(boundary),
						rest.subarray(take),
					]);
					headHeld = Buffer.alloc(0);
				} else {
					headHeld = combined.subarray(boundary);
					rest = Buffer.alloc(0);
				}
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
				// A genuinely truncated stream still surfaces its dangling
				// character as U+FFFD rather than silently losing it.
				if (headHeld.length > 0) append(headHeld.toString('utf8'));
				return;
			}

			const text = tail.decode();
			const omitted = tail.omittedBytes;
			// Nothing between the windows: head and tail reproduce the stream, so
			// a notice would only corrupt it.
			if (omitted > 0) append(emitNotice(omitted, totalBytes));
			if (text) append(text);
		},
	};
}

function makeKeepLatestCollector(
	append: (text: string) => void,
	notice: TruncationNotice | string,
	options: StreamCollectorOptions,
): StreamCollector {
	const marker = typeof notice === 'string' ? notice : notice(0, 0);
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
			options.onTrim?.(droppedChars);
		}
		tail = next;
	};

	return {
		collect: (data: Buffer) => {
			deliverText(decoder.write(data));
		},
		flush: () => {
			const rest = decoder.end();
			if (rest) deliverText(rest);
		},
	};
}
