/**
 * Hand a prompt back to the composer, so a restored prompt can be edited and
 * sent again instead of being re-sent blindly.
 *
 * The composer owns its draft state deep inside `UserInput`, and commands are
 * dispatched from a different branch of the tree, so the two cannot share a
 * prop. A tiny subscription keeps the hand-off to one call site on each side.
 */

export type ComposerPrefillListener = (text: string) => void;

const listeners = new Set<ComposerPrefillListener>();

/** Show `text` in the composer, replacing the draft. */
export function prefillComposer(text: string): void {
	for (const listener of listeners) {
		listener(text);
	}
}

/** Called by the composer. Returns the unsubscribe function. */
export function subscribeComposerPrefill(
	listener: ComposerPrefillListener,
): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
