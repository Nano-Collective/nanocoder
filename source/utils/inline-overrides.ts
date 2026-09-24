/**
 * Parse inline `?key=value` tokens out of a slash command's args array, plus
 * the helpers used by the slash-command dispatcher to apply them.
 *
 * Lets a user test a per-session setting for a single command without
 * committing it to the global session state, e.g.
 *
 *   /usage ?context-max=200k
 *   /compact ?preview
 *
 * Only arguments whose first character is `?` are considered; anything else
 * is preserved as-is in the returned `args`. A bare `?flag` (no `=`) becomes
 * `{ key: 'flag', value: true }` so handlers can opt into boolean toggles
 * like `/compact ?preview`.
 *
 * Scope notes (see #1151 review): the one key with a synchronous reader
 * during slash-command dispatch is `context-max` on `/usage` (which reads
 * `getSessionContextLimit()` inside its awaited handler). `threshold` is
 * additionally observed by `/compact` via an explicit once-threshold gate
 * (see `handleCompactCommand`'s `onceThreshold` parameter): when present,
 * manual compaction is skipped with an informational message if current
 * usage sits below the threshold, mirroring the automatic path's gate.
 * `auto-compact` is applied through the same session-override plumbing and
 * restored to its prior value, but no built-in slash command currently
 * reads it synchronously during dispatch — the automatic compaction path
 * (`maybeAutoCompact`) only runs on chat turns. It is kept as reserved
 * plumbing (with round-trip apply/restore tests) rather than advertised
 * as a working command example.
 *
 * Unknown `?foo=bar` keys are never consumed: they are excluded from the
 * session-override stores and from flag expansion, forwarded to the command
 * handler verbatim so each command's own unknown-arg handling runs, and
 * surfaced once by the dispatcher as a warning so a typo cannot silently
 * no-op.
 *
 * Value validation in `applyOnceOverrides` is best-effort: unparseable or
 * out-of-range values are ignored (no apply, no restore, no error). For
 * strict validation with an explicit error message, use the regular
 * `--flag value` form of the same argument.
 */

import {COMPRESSION_CONSTANTS} from './message-compression';

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
		if (!arg.startsWith('?')) {
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
 * to a single `--preview` token. Keys that have once-scoped overrides (e.g.
 * `?auto-compact`, `?threshold`) are NOT expanded here - they're only handled
 * via `applyOnceOverrides`.
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

/** Once-scoped keys consumed by `applyOnceOverrides` (never forwarded). */
const ONCE_SCOPED_KEYS = new Set(['threshold', 'auto-compact', 'context-max']);

/**
 * Whether the dispatcher recognises this override key: either a once-scoped
 * session-override key or a legacy boolean flag. Anything else is forwarded
 * to the command handler verbatim (see `formatInlineToken`) so typos and
 * command-specific keys stay visible instead of silently vanishing.
 */
export function isRecognizedOverrideKey(key: string): boolean {
	return ONCE_SCOPED_KEYS.has(key) || key in LEGACY_FLAG_NAMES;
}

/**
 * Rebuild the original `?key` / `?key=value` token from a parsed override.
 * Lossless for everything `parseInlineOverrides` produces: a boolean `true`
 * came from a bare `?flag`, any other value followed an `=`.
 */
export function formatInlineToken({key, value}: InlineOverride): string {
	return value === true ? `?${key}` : `?${key}=${value}`;
}

const TRUE_STRINGS = new Set(['1', 'true', 'yes', 'on']);

function toBoolean(value: string | boolean): boolean {
	if (typeof value === 'boolean') return value;
	return TRUE_STRINGS.has(value.toLowerCase());
}

/**
 * Expand a list of `?key=value` overrides into the corresponding
 * `--key` CLI args. Used when the override should flow through to
 * the existing command handler as if the user had typed the long form.
 * Every entry in `LEGACY_FLAG_NAMES` is a boolean flag, so string values
 * go through `toBoolean` instead of being forwarded as a stray positional
 * token (e.g. `?preview=yes` becomes `--preview`, not `--preview yes`).
 */
export function expandOverrideArgs(
	overrides: readonly InlineOverride[],
): string[] {
	const out: string[] = [];
	for (const {key, value} of overrides) {
		const flag = LEGACY_FLAG_NAMES[key];
		if (!flag) continue;
		if (toBoolean(value)) out.push(flag);
	}
	return out;
}

/**
 * `applyOnceOverrides` writes each recognised override into the existing
 * session-override stores (see `source/utils/auto-compact-session.ts` and
 * `source/models/index.ts`) and returns a `restore` callback. The caller
 * MUST invoke `restore` once the command finishes - typically in a
 * `finally` block - so the override only applies to the single command
 * the user typed it on.
 *
 * Unknown override keys are ignored here. The dispatcher uses
 * `expandOverrideArgs` to forward them to the command handler as ordinary
 * flags, so `?preview` still works for any command that understands it.
 *
 * The `restore` callback reverts each applied override to its **prior
 * value** (not to `null`), so a pre-existing session override is preserved
 * across the once-scoped change. Unparseable or out-of-range values are
 * silently skipped (no apply, no restore).
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
	// (COMPRESSION_CONSTANTS is a static import: message-compression has no
	// runtime imports of its own, so it adds nothing to the init graph.)
	const [
		{
			autoCompactSessionOverrides,
			setAutoCompactEnabled,
			setAutoCompactThreshold,
		},
		models,
		{parseContextLimit},
	] = await Promise.all([
		import('./auto-compact-session.js'),
		import('@/models/index.js'),
		import('./parse-context-limit.js'),
	]);

	for (const {key, value} of overrides) {
		switch (key) {
			case 'threshold': {
				const numeric = Number.parseFloat(String(value));
				// Out-of-range values are silently skipped (no apply, no
				// restore) - matches the documented "best-effort" validation.
				if (
					Number.isNaN(numeric) ||
					numeric < COMPRESSION_CONSTANTS.MIN_THRESHOLD_PERCENT ||
					numeric > COMPRESSION_CONSTANTS.MAX_THRESHOLD_PERCENT
				)
					break;
				const prior = autoCompactSessionOverrides.threshold;
				setAutoCompactThreshold(Math.round(numeric));
				restorations.push(() => setAutoCompactThreshold(prior));
				break;
			}
			case 'auto-compact': {
				const bool = toBoolean(value);
				const prior = autoCompactSessionOverrides.enabled;
				setAutoCompactEnabled(bool);
				restorations.push(() => setAutoCompactEnabled(prior));
				break;
			}
			case 'context-max': {
				const numeric = parseContextLimit(String(value));
				if (numeric === null) break;
				const prior = models.getSessionContextLimit();
				models.setSessionContextLimit(numeric);
				restorations.push(() => models.setSessionContextLimit(prior));
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

/**
 * Extract the once-scoped `threshold` value from already-parsed overrides
 * for explicit consumers (`/compact`'s gate). Mirrors the validation in
 * `applyOnceOverrides` — last valid value wins, anything unparseable or
 * out of range yields `undefined` (fail open: the command runs un-gated).
 * Returns `undefined` when no `?threshold` override is present so callers
 * can tell "no once-threshold" apart from a persisted session override and
 * leave the default unconditional behaviour untouched.
 */
export function getOnceThreshold(
	overrides: readonly InlineOverride[],
): number | undefined {
	let found: number | undefined;
	for (const {key, value} of overrides) {
		if (key !== 'threshold') continue;
		const numeric = Number.parseFloat(String(value));
		if (
			Number.isNaN(numeric) ||
			numeric < COMPRESSION_CONSTANTS.MIN_THRESHOLD_PERCENT ||
			numeric > COMPRESSION_CONSTANTS.MAX_THRESHOLD_PERCENT
		) {
			continue;
		}
		found = Math.round(numeric);
	}
	return found;
}
