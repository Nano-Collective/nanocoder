import {createRequire} from 'node:module';

type HighlightFunction = typeof import('cli-highlight').highlight;
type CliHighlightModule = typeof import('cli-highlight');

// Syntax highlighting is only needed when a code block or file preview is
// actually rendered. Keep the import synchronous for Ink render paths, but
// defer loading cli-highlight and its parser dependencies until that first use.
const require = createRequire(import.meta.url);
let cachedHighlight: HighlightFunction | undefined;

function loadHighlight(): HighlightFunction {
	if (!cachedHighlight) {
		const cliHighlight = require('cli-highlight') as CliHighlightModule;
		cachedHighlight = cliHighlight.highlight;
	}
	return cachedHighlight;
}

export function highlightCode(
	...args: Parameters<HighlightFunction>
): ReturnType<HighlightFunction> {
	return loadHighlight()(...args);
}
