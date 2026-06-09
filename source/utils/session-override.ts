/**
 * A single session-scoped override value: null until a user sets it (e.g. via
 * `/context-max` or the auto-compact controls), cleared on reset. `normalize`
 * runs on every set so callers can clamp / validate (out-of-range inputs
 * collapse back to null or a bounded value).
 */
export interface SessionOverride<T> {
	get(): T | null;
	set(value: T | null): void;
	reset(): void;
}

export function createSessionOverride<T>(
	normalize: (value: T | null) => T | null = value => value,
): SessionOverride<T> {
	let current: T | null = null;
	return {
		get: () => current,
		set(value) {
			current = normalize(value);
		},
		reset() {
			current = null;
		},
	};
}
