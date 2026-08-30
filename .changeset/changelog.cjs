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

	// Pass the author's markdown through faithfully. If they already wrote one or
	// more markdown list items (the usual case, and how a consolidated entry with
	// several bullets is written), emit it verbatim. Otherwise treat the whole
	// summary as a single bullet.
	const isMarkdownList = /^\s*[-*]\s/.test(summary);
	const body = isMarkdownList ? summary : `- ${summary}`;

	return `\n${body}`;
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
