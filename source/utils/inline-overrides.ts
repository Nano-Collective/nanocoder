/**
 * Parse inline `?key=value` tokens out of a slash command's args array, plus
 * the helpers used by the slash-command dispatcher to apply them.
 *
 * Lets a user test a per-session setting for a single command without
 * committing it to the global session state, e.g.
 *
 *   /compact ?threshold=80
 *   /context-max 128k ?once
 *
 * Only arguments whose first character is `?` are considered; anything else
 * is preserved as-is in the returned `args`. A bare `?flag` (no `=`) becomes
 * `{ key: 'flag', value: true }` so handlers can opt into boolean toggles
 * like `/compact ?preview`.
 */

export interface InlineOverride {
	key: string;
	value: string | boolean;
}

export interface ParseInlineOverridesResult {
	args: string[];
	overrides: InlineOverride[];
}

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export function parseInlineOverrides(
	rawArgs: readonly string[],
): ParseInlineOverridesResult {
	const args: string[] = [];
	const overrides: InlineOverride[] = [];

	for (const arg of rawArgs) {
		if (typeof arg !== 'string' || !arg.startsWith('?')) {
			args.push(arg);
			continue;
		}

		// Strip the leading `?` and split on the first `=`.
		const body = arg.slice(1);
		const eq = body.indexOf('=');
		let key: string;
		let value: string | boolean;
		if (eq === -1) {
			key = body;
			value = true;
		} else {
			key = body.slice(0, eq);
			value = body.slice(eq + 1);
		}

		if (!KEY_PATTERN.test(key)) {
			// Not a recognised override shape: keep it in args so the user
			// gets a normal 'unknown arg' error from the command rather than
			// the parser silently swallowing it.
			args.push(arg);
			continue;
		}

		overrides.push({key, value});
	}

	return {args, overrides};
}

/**
 * Map of `?flag` names that should be expanded into the corresponding
 * `--flag value` CLI args so existing slash-command handlers can stay
 * oblivious to the override feature. Boolean overrides (`?preview`) expand
 * to a single `--preview` token. Override-style keys (e.g. `?threshold=80`)
 * are handled by `applyOnceOverrides` instead of being duplicated here.
 */
const LEGACY_FLAG_NAMES: Record<string, string> = {
	preview: '--preview',
	llm: '--llm',
	mechanical: '--mechanical',
	aggressive: '--aggressive',
	conservative: '--conservative',
	'auto-on': '--auto-on',
	'auto-off': '--auto-off',
};

const TRUE_STRINGS = new Set(['1', 'true', 'yes', 'on']);

function toBoolean(value: string | boolean): boolean {
	if (typeof value === 'boolean') return value;
	return TRUE_STRINGS.has(value.toLowerCase());
}

/**
 * Expand a list of `?key=value` overrides into the corresponding
 * `--key value` CLI args. Used when the override should flow through to
 * the existing command handler as if the user had typed the long form.
 */
export function expandOverrideArgs(
	overrides: readonly InlineOverride[],
): string[] {
	const out: string[] = [];
	for (const {key, value} of overrides) {
		const flag = LEGACY_FLAG_NAMES[key];
		if (!flag) continue;
		if (typeof value === 'boolean') {
			if (value) out.push(flag);
		} else {
			out.push(flag, value);
		}
	}
	return out;
}

/**
 * `applyOnceOverrides` writes each recognised override into the existing
 * session-override stores (see `source/utils/auto-compact.ts` and
 * `source/models/index.ts`) and returns a `restore` callback. The caller
 * MUST invoke `restore` once the command finishes - typically in a
 * `finally` block - so the override only applies to the single command
 * the user typed it on.
 *
 * Unknown override keys are ignored here. The dispatcher uses
 * `expandOverrideArgs` to forward them to the command handler as ordinary
 * flags, so `?preview` still works for any command that understands it.
 *
 * The session-override setters are pulled in lazily. The dispatcher is
 * the only caller of this function and only runs once per slash command,
 * so paying the import cost on first use keeps the parser specs free
 * from the heavy chat-handler / config / tokenization init graph.
 */
export async function applyOnceOverrides(
	overrides: readonly InlineOverride[],
): Promise<() => void> {
	const restorations: Array<() => void> = [];

	if (overrides.length === 0) {
		return () => {};
	}

	// Only import the setter modules when we actually have an override
	// to apply. Keeps `parseInlineOverrides` testable in isolation.
	const [{setAutoCompactEnabled, setAutoCompactThreshold}, models] =
		await Promise.all([
			import('./auto-compact.js'),
			import('@/models/index.js'),
		]);

	for (const {key, value} of overrides) {
		switch (key) {
			case 'threshold': {
				const numeric = Number.parseFloat(String(value));
				if (!Number.isNaN(numeric)) {
					setAutoCompactThreshold(
						Math.max(50, Math.min(95, Math.round(numeric))),
					);
					restorations.push(() => setAutoCompactThreshold(null));
				}
				break;
			}
			case 'auto-compact': {
				const bool = toBoolean(value);
				setAutoCompactEnabled(bool);
				restorations.push(() => setAutoCompactEnabled(null));
				break;
			}
			case 'context-max': {
				const numeric = Number.parseInt(String(value), 10);
				if (!Number.isNaN(numeric) && numeric > 0) {
					models.setSessionContextLimit(numeric);
					restorations.push(() => models.resetSessionContextLimit());
				}
				break;
			}
			// No default: keys not listed here fall through to
			// `expandOverrideArgs` in the dispatcher.
		}
	}

	return () => {
		for (const restore of restorations) {
			try {
				restore();
			} catch {
				// A single failed restore (e.g. someone reset the override
				// concurrently) should not block the rest from running.
			}
		}
	};
}
