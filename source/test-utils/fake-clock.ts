/**
 * A hand-driven clock for code that takes injectable setTimeout /
 * clearTimeout (e.g. MCPHealthMonitor). Time only moves when a test calls
 * advance(), and every callback's async follow-up settles before advance()
 * returns, so tests assert exact delays instead of polling real time.
 */

type TimerHandle = ReturnType<typeof setTimeout>;

interface PendingTimer {
	at: number;
	delay: number;
	callback: () => void;
}

/** Let every queued promise continuation run. */
export const settle = async () => {
	for (let i = 0; i < 5; i++) {
		await new Promise<void>(resolve => setImmediate(resolve));
	}
};

export class FakeClock {
	now = 0;
	private nextId = 1;
	private timers = new Map<number, PendingTimer>();

	setTimeout = (callback: () => void, delay: number): TimerHandle => {
		const id = this.nextId++;
		this.timers.set(id, {at: this.now + delay, delay, callback});
		return id as unknown as TimerHandle;
	};

	clearTimeout = (handle: TimerHandle): void => {
		this.timers.delete(handle as unknown as number);
	};

	get pendingCount(): number {
		return this.timers.size;
	}

	/** The requested delay of every pending timer, in scheduling order. */
	pendingDelays(): number[] {
		return [...this.timers.values()].map(timer => timer.delay);
	}

	/**
	 * Move time forward by `ms`, firing due timers in time order (including
	 * ones scheduled by earlier callbacks) and settling after each.
	 */
	async advance(ms: number): Promise<void> {
		const target = this.now + ms;
		await settle();
		for (;;) {
			let nextId: number | undefined;
			let next: PendingTimer | undefined;
			for (const [id, timer] of this.timers) {
				if (timer.at <= target && (!next || timer.at < next.at)) {
					nextId = id;
					next = timer;
				}
			}
			if (nextId === undefined || !next) break;
			this.timers.delete(nextId);
			this.now = next.at;
			next.callback();
			await settle();
		}
		this.now = target;
	}
}
