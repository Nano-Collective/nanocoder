/**
 * Local-timezone date helpers for the lifetime stats ledger.
 */

/** Format a Date as local YYYY-MM-DD. */
export function toLocalDateKey(date: Date = new Date()): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

/** Parse YYYY-MM-DD as local midnight. */
function parseLocalDateKey(key: string): Date {
	const [ys, ms, ds] = key.split('-');
	const y = Number(ys);
	const m = Number(ms);
	const d = Number(ds);
	return new Date(y, m - 1, d);
}

/** Inclusive list of local date keys from start..end (YYYY-MM-DD). */
export function eachLocalDate(startKey: string, endKey: string): string[] {
	const out: string[] = [];
	const cur = parseLocalDateKey(startKey);
	const end = parseLocalDateKey(endKey);
	while (cur <= end) {
		out.push(toLocalDateKey(cur));
		cur.setDate(cur.getDate() + 1);
	}
	return out;
}

/** Subtract days from a local date key. */
export function addLocalDays(dateKey: string, deltaDays: number): string {
	const d = parseLocalDateKey(dateKey);
	d.setDate(d.getDate() + deltaDays);
	return toLocalDateKey(d);
}

/** Month key YYYY-MM from a date key. */
export function toMonthKey(dateKey: string): string {
	return dateKey.slice(0, 7);
}

/** Short weekday label for a local date key (Mon, Tue, …). */
export function weekdayLabel(dateKey: string): string {
	const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	return labels[parseLocalDateKey(dateKey).getDay()] ?? dateKey;
}

/** Short month label from YYYY-MM (Jan, Feb, …). */
export function monthLabel(monthKey: string): string {
	const labels = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec',
	];
	const month = Number(monthKey.slice(5, 7));
	return labels[month - 1] ?? monthKey;
}
