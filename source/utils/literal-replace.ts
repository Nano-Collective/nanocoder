/**
 * Replace the first occurrence of `search` with `replacement`, treating the
 * replacement as literal text.
 *
 * `String.prototype.replace` runs GetSubstitution over its second argument, so
 * `$$`, `$&`, "$`" and `$'` are rewritten before the result is produced. Those
 * are ordinary characters in shell scripts, Makefiles, CI YAML and anything
 * that builds a regex, so an edit tool that passes model-supplied text straight
 * to `replace` silently writes bytes nobody approved — and "$`" / `$'` splice
 * a whole half of the file into the middle of the edit.
 *
 * Splicing by index sidesteps substitution parsing entirely and avoids
 * re-scanning the string for a second pass.
 */
export function replaceFirstLiteral(
	content: string,
	search: string,
	replacement: string,
): string {
	const index = content.indexOf(search);
	if (index === -1) {
		return content;
	}

	return (
		content.slice(0, index) + replacement + content.slice(index + search.length)
	);
}
