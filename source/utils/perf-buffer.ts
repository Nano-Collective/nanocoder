/**
 * Performance entry buffer guard.
 *
 * Ink renders the UI via `react-reconciler@0.33`, which (in its development
 * build, which is what ships in `node_modules`) calls `performance.measure()`
 * and `performance.mark()` on every render to surface user-timing entries to
 * the React DevTools track. Those entries are pushed into Node's global
 * performance entry buffer and are never released, because we don't run a
 * `PerformanceObserver` to drain them and there is no equivalent of React
 * DevTools in a terminal.
 *
 * Over a long-running session — particularly one that spawns many subagent
 * runs and re-renders the chat UI for hours — the buffer accumulates millions
 * of entries, V8 spends progressively more time mark-compacting it, and the
 * process eventually crashes with:
 *
 *   FATAL ERROR: Ineffective mark-compacts near heap limit
 *   Allocation failed - JavaScript heap out of memory
 *
 * (See https://github.com/Nano-Collective/nanocoder/issues/521.)
 *
 * The mitigation is intentionally narrow: periodically drop the buffered
 * `mark` / `measure` entries. We don't read them anywhere in the app, so this
 * is lossless from our perspective, and it caps the buffer to at most one
 * interval's worth of entries instead of letting it grow unbounded.
 */

const DEFAULT_INTERVAL_MS = 30_000;

let installed = false;

export function installPerfBufferGuard(
	intervalMs: number = DEFAULT_INTERVAL_MS,
): void {
	if (installed) return;
	if (
		typeof performance === 'undefined' ||
		typeof performance.clearMarks !== 'function' ||
		typeof performance.clearMeasures !== 'function'
	) {
		return;
	}
	installed = true;
	const timer = setInterval(() => {
		try {
			performance.clearMarks();
			performance.clearMeasures();
			// Node's built-in fetch (undici) also pushes a resource-timing
			// entry per request into the same buffer. Drain those too so long
			// chat sessions with many provider/MCP requests don't accumulate
			// them indefinitely.
			if (typeof performance.clearResourceTimings === 'function') {
				performance.clearResourceTimings();
			}
		} catch {
			// Best-effort: never let buffer maintenance crash the app.
		}
	}, intervalMs);
	// Don't keep the event loop alive just for this housekeeping timer.
	if (typeof timer.unref === 'function') {
		timer.unref();
	}
}
