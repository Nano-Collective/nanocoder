/**
 * Optional publisher used by the conversation tool executor to surface
 * tool start/finish events to an active browser turn. Terminal mode leaves
 * this unset; web mode binds it through the runtime bridge.
 */

export interface WebToolLifecyclePublisher {
	started: (id: string, name: string, args?: Record<string, unknown>) => void;
	finished: (id: string, name: string, ok: boolean, output?: string) => void;
}

let publisher: WebToolLifecyclePublisher | null = null;

export function setWebToolLifecyclePublisher(
	next: WebToolLifecyclePublisher | null,
): void {
	publisher = next;
}

export function publishWebToolStarted(
	id: string,
	name: string,
	args?: Record<string, unknown>,
): void {
	publisher?.started(id, name, args);
}

export function publishWebToolFinished(
	id: string,
	name: string,
	ok: boolean,
	output?: string,
): void {
	publisher?.finished(id, name, ok, output);
}
