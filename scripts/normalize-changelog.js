#!/usr/bin/env node

/**
 * Post-process CHANGELOG.md after `changeset version` so the freshly written
 * top section matches Nanocoder's long-standing house style:
 *
 *   - Changesets writes the new release as a level-2 heading ("## 1.29.0")
 *     under the package title. We use level-1 version headings ("# 1.29.0").
 *   - Changesets groups entries under "### Major/Minor/Patch Changes" headers.
 *     We keep a single flat bullet list, and those "###" headers additionally
 *     break scripts/extract-changelog.js (its capture stops at the first "##+"
 *     heading), so they must go.
 *   - Every release section ends with our standard closing paragraph.
 *
 * The package-title H1 ("# @nanocollective/nanocoder") is kept permanently at
 * the top of the file - Changesets needs a non-version first line to prepend
 * new releases in the right place.
 *
 * The script is idempotent: if the newest section is already normalised (a
 * level-1 heading), it does nothing.
 */

import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const changelogPath = join(rootDir, 'CHANGELOG.md');

const BOILERPLATE =
	'If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder.';

const raw = readFileSync(changelogPath, 'utf8');

// Split into the title block + one entry per version heading. A version heading
// is a line starting with `# ` or `## ` followed by a digit. The lookahead
// keeps the heading with its section; the separating newline is consumed.
const sections = raw.split(/\n(?=#{1,2} \d)/);

// sections[0] is the title block; sections[1] is the newest release.
if (sections.length < 2) {
	process.exit(0);
}

const newest = sections[1];

// Idempotency guard: only act on a raw Changesets section (level-2 heading).
if (!/^## \d/.test(newest)) {
	process.exit(0);
}

let normalized = newest
	// Promote the version heading from level-2 to level-1.
	.replace(/^## /, '# ')
	// Drop the "### Major/Minor/Patch Changes" group headers.
	.replace(/^### (?:Major|Minor|Patch) Changes[^\n]*\n?/gm, '');

// Collapse any runs of blank lines left behind, and trim trailing whitespace.
normalized = normalized.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');

// Ensure the closing boilerplate paragraph is present exactly once.
if (!normalized.includes(BOILERPLATE)) {
	normalized = `${normalized}\n\n${BOILERPLATE}`;
}

// Restore the blank line that separates this section from the previous one
// (the split consumed it and the trim above removed the trailing newline).
sections[1] = `${normalized}\n`;

writeFileSync(changelogPath, sections.join('\n'), 'utf8');
console.log('✅ CHANGELOG.md normalised to house style');
