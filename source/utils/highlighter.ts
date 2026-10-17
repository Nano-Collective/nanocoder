import {createRequire} from 'node:module';
import type {HighlightOptions} from 'cli-highlight';

let highlightFn: typeof import('cli-highlight').highlight | null = null;

function getHighlight(): typeof import('cli-highlight').highlight {
	if (!highlightFn) {
		const req = createRequire(import.meta.url);
		const cliHighlight = req('cli-highlight') as typeof import('cli-highlight');
		highlightFn = cliHighlight.highlight;
	}
	return highlightFn;
}

/**
 * Synchronously highlights code on first use, deferring the load of
 * `cli-highlight`, `highlight.js` (193 language modules) and `parse5`
 * until syntax highlighting is actually needed.
 */
export function highlight(code: string, options?: HighlightOptions): string {
	return getHighlight()(code, options);
}
