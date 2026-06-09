/**
 * Mustache section expansion, shared by the custom-tool template engine
 * (source/custom-tools/template.ts) and the custom-command executor
 * (source/custom-commands/executor.ts).
 *
 * Only section logic lives here. Variable substitution (`{{ name }}`) stays
 * with each caller because the rules differ: tools shell-quote substituted
 * values, commands inject them verbatim into a prompt. The truthiness rule
 * that gates a section is also the caller's (a tool arg can be an array or
 * number; a command arg is always a string), so it's passed in as `isTruthy`.
 *
 * Supported:
 *   {{# name }}…{{/ name }}   positive section: kept when isTruthy(name)
 *   {{^ name }}…{{/ name }}   inverted section: kept when !isTruthy(name)
 * Nested sections collapse from the inside out.
 */

/**
 * Expand positive and inverted sections in `body`. The closing tag must match
 * the opening tag's name. `isTruthy(name)` decides whether a positive section
 * is kept; inverted sections use its complement.
 */
export function expandSections(
	body: string,
	isTruthy: (name: string) => boolean,
): string {
	// `[\s\S]` so a section can span newlines; non-greedy so adjacent sections
	// don't merge. The sigil ([#^]) is captured so both kinds share one pass,
	// and `\2` backreferences the captured name for the closing tag.
	const sectionRegex =
		/\{\{([#^])\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/g;

	let prev: string;
	let next = body;
	let safety = 0;
	do {
		prev = next;
		next = prev.replace(
			sectionRegex,
			(_match, sigil: string, name: string, inner: string) => {
				const truthy = isTruthy(name);
				const include = sigil === '#' ? truthy : !truthy;
				return include ? expandSections(inner, isTruthy) : '';
			},
		);
		safety++;
	} while (next !== prev && safety < 16);
	return next;
}
