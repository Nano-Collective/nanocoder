/**
 * Serializes user prompts in the VS Code chat panel so a follow-up typed
 * while a turn is in flight is queued instead of being rejected (or racing
 * a second ACP `prompt()` that the agent would throw on).
 *
 * The in-flight turn is *not* stored here — `submit()` returning `'started'`
 * means the caller should run it immediately. Only waiting follow-ups live
 * in `_entries`.
 */

export interface QueuedPrompt {
	id: string;
	text: string;
	images?: {data: string; mimeType: string}[];
}

export class PromptQueue {
	private _entries: QueuedPrompt[] = [];
	private _turnActive = false;

	get turnActive(): boolean {
		return this._turnActive;
	}

	/** Ids of waiting follow-ups, in FIFO order. Does not include the in-flight turn. */
	get ids(): string[] {
		return this._entries.map(entry => entry.id);
	}

	/**
	 * Accept a prompt. Returns `'started'` when the caller should run it now
	 * (and marks the turn active so a second submit queues). Returns `'queued'`
	 * when a turn is already in flight.
	 */
	submit(entry: QueuedPrompt): 'started' | 'queued' {
		if (this._turnActive) {
			this._entries.push(entry);
			return 'queued';
		}
		this._turnActive = true;
		return 'started';
	}

	/**
	 * Mark the current turn finished and pop the next waiting prompt, or
	 * `null` if the queue is empty. A returned entry leaves `turnActive`
	 * true so the caller can start it without a second `submit()`.
	 */
	completeAndDequeue(): QueuedPrompt | null {
		const next = this._entries.shift() ?? null;
		this._turnActive = next !== null;
		return next;
	}

	/** Remove one waiting prompt. Returns false if it was already gone (or in flight). */
	remove(id: string): boolean {
		const next = this._entries.filter(entry => entry.id !== id);
		if (next.length === this._entries.length) {
			return false;
		}
		this._entries = next;
		return true;
	}

	/**
	 * Drop every waiting prompt. Does **not** release `turnActive` — the
	 * in-flight turn's `completeAndDequeue()` does that once ACP cancel
	 * settles. Releasing here would let a new Enter start a second
	 * `prompt()` while the cancelled one is still in `finally`.
	 */
	clear(): string[] {
		const ids = this.ids;
		this._entries = [];
		return ids;
	}
}
