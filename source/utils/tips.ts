import {TIPS} from '@/constants';

/**
 * Tips whose text mentions `query` (case-insensitive substring). An empty
 * query matches the whole catalogue, so `/tip` with no argument and `/tip
 * <text>` share one code path.
 */
export function findTips(query: string): string[] {
	const needle = query.trim().toLowerCase();
	return needle
		? TIPS.filter(tip => tip.toLowerCase().includes(needle))
		: [...TIPS];
}

/**
 * Pick one tip out of `tips` using an injectable random source so tests can
 * pin the result. `tips` must be non-empty.
 *
 * The `?? tips[0]` arm is unreachable for a well-behaved source, but keeps an
 * out-of-range injected `random` (>= 1, or negative) from handing back
 * `undefined`. The index signature will not surface that on its own because
 * `noUncheckedIndexedAccess` is off in this project.
 */
export function pickTip(
	tips: readonly string[],
	random: () => number = Math.random,
): string {
	return tips[Math.floor(random() * tips.length)] ?? tips[0];
}

/**
 * Return one tip from the full catalogue. `exclude` drops a tip from the pool
 * so back-to-back `/tip` runs do not repeat the line already on screen; it is
 * ignored if excluding it would empty the pool.
 */
export function getRandomTip(
	random: () => number = Math.random,
	exclude?: string,
): string {
	const pool = TIPS.filter(tip => tip !== exclude);
	return pickTip(pool.length > 0 ? pool : TIPS, random);
}
