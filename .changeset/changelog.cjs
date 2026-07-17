/**
 * Custom Changesets changelog formatter for Nanocoder.
 *
 * Each changeset file's markdown body IS the changelog entry, verbatim - the
 * same curated voice we have always used ("Added **X**... Thanks to @y. Closes
 * #z."). We deliberately drop the commit-hash / PR-link decoration that the
 * default formatter adds, so the rendered CHANGELOG.md keeps its clean prose.
 *
 * The structural cleanup (heading level, removing the "### Patch Changes"
 * group headers, appending the closing boilerplate) happens afterwards in
 * scripts/normalize-changelog.js, which runs as part of `changeset:version`.
 */

async function getReleaseLine(changeset) {
	const summary = (changeset.summary || '').trim();
	if (!summary) return '';

	// Preserve multi-line entries: first line becomes the bullet, continuation
	// lines are indented so they stay part of the same list item.
	const [first, ...rest] = summary.split('\n');
	const continuation = rest
		.map(line => (line.trim() === '' ? '' : `  ${line.trimEnd()}`))
		.join('\n');

	return `\n- ${first.trimEnd()}${continuation ? `\n${continuation}` : ''}`;
}

async function getDependencyReleaseLine() {
	// We do not surface internal dependency bumps in the user-facing changelog.
	return '';
}

module.exports = {
	getReleaseLine,
	getDependencyReleaseLine,
	default: {getReleaseLine, getDependencyReleaseLine},
};
