/**
 * Keeps streaming model output from competing with the UI for the event loop.
 *
 * `StreamFramer` turns per-token deltas into frames: text is buffered and
 * handed to the UI at most once per frame interval, and the interval backs
 * off while the event loop is lagging (on a slow machine, a busy render or a
 * running tool), then returns once it is calm again.
 *
 * `createStreamYielder` time-slices the loop that reads the stream. A backlog
 * of buffered chunks is otherwise processed back-to-back with no break, which
 * holds off keypresses (Escape, Ctrl+C), timers and terminal paints.
 */

/** Frame interval when the event loop is keeping up. */
export const BASE_FRAME_INTERVAL_MS = 50;
/** Ceiling for the backed-off interval. */
export const MAX_FRAME_INTERVAL_MS = 400;
/** A frame that fires this much later than scheduled counts as lag. */
export const FRAME_LAG_THRESHOLD_MS = 30;
/** On-time frames in a row before the interval steps back down. */
export const FRAME_RECOVERY_FRAMES = 3;
/** Longest stretch of stream processing before the loop yields. */
export const STREAM_SLICE_BUDGET_MS = 16;

type StreamKind = 'text' | 'reasoning';

export interface FrameSink {
	onText(text: string): void;
	onReasoning(text: string): void;
}

/** Time source, injectable so tests can control when frames fire. */
export interface FrameClock {
	now(): number;
	setTimeout(callback: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
}

const systemClock: FrameClock = {
	now: () => Date.now(),
	setTimeout: (callback, ms) => setTimeout(callback, ms),
	clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class StreamFramer {
	private buffer = '';
	// Which callback the buffered run belongs to. Set by the delta that filled
	// the buffer, never by start/end markers: providers disagree on those (the
	// Responses API defers reasoning-end until the reasoning item completes,
	// openai-compatible reopens reasoning without closing text, and some emit
	// deltas with no start at all).
	private kind: StreamKind = 'text';
	private timer: unknown = null;
	private dueAt = 0;
	private intervalMs = BASE_FRAME_INTERVAL_MS;
	private onTimeFrames = 0;

	constructor(
		private readonly sink: FrameSink,
		private readonly clock: FrameClock = systemClock,
	) {}

	/** The current frame interval, after any lag back-off. */
	get frameIntervalMs(): number {
		return this.intervalMs;
	}

	/**
	 * Buffer a delta. Switching between text and reasoning first hands over
	 * what the other kind buffered, so a frame always reaches the callback it
	 * was filled for, in order.
	 */
	push(kind: StreamKind, text: string): void {
		if (!text) return;
		if (kind !== this.kind) {
			this.flush();
			this.kind = kind;
		}
		this.buffer += text;
		if (this.timer === null) {
			this.dueAt = this.clock.now() + this.intervalMs;
			this.timer = this.clock.setTimeout(() => this.onFrame(), this.intervalMs);
		}
	}

	/** Hand over anything buffered now (a part boundary, or the stream end). */
	flush(): void {
		if (this.timer !== null) {
			this.clock.clearTimeout(this.timer);
			this.timer = null;
		}
		this.emit();
	}

	private onFrame(): void {
		this.timer = null;
		this.adapt(this.clock.now() - this.dueAt);
		this.emit();
	}

	/**
	 * A late frame means something else held the event loop; drawing less
	 * often gives that time back. The interval doubles per late frame up to
	 * the ceiling, and halves after a run of on-time frames.
	 */
	private adapt(lagMs: number): void {
		if (lagMs > FRAME_LAG_THRESHOLD_MS) {
			this.intervalMs = Math.min(this.intervalMs * 2, MAX_FRAME_INTERVAL_MS);
			this.onTimeFrames = 0;
			return;
		}
		this.onTimeFrames++;
		if (
			this.onTimeFrames >= FRAME_RECOVERY_FRAMES &&
			this.intervalMs > BASE_FRAME_INTERVAL_MS
		) {
			this.intervalMs = Math.max(this.intervalMs / 2, BASE_FRAME_INTERVAL_MS);
			this.onTimeFrames = 0;
		}
	}

	private emit(): void {
		if (!this.buffer) return;
		const text = this.buffer;
		this.buffer = '';
		if (this.kind === 'reasoning') {
			this.sink.onReasoning(text);
		} else {
			this.sink.onText(text);
		}
	}
}

/**
 * Returns a function to await after each stream chunk. It yields to the
 * event loop once {@link STREAM_SLICE_BUDGET_MS} of continuous processing
 * has passed, so input, timers and paints are never held off for longer.
 */
export function createStreamYielder(
	clock: Pick<FrameClock, 'now'> = systemClock,
	budgetMs: number = STREAM_SLICE_BUDGET_MS,
	yieldToEventLoop: () => Promise<void> = () =>
		new Promise(resolve => setTimeout(resolve, 0)),
): () => Promise<void> {
	let sliceStart = clock.now();
	return async () => {
		if (clock.now() - sliceStart < budgetMs) return;
		await yieldToEventLoop();
		sliceStart = clock.now();
	};
}
