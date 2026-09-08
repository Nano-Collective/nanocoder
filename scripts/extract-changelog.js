#!/usr/bin/env node

/**
 * Print one version's section of CHANGELOG.md, for a GitHub Release body.
 *
 *   node extract-changelog.js [version]
 *
 * The version defaults to the one in package.json.
 *
 * Kept in this repository rather than shared, unlike the other package repos:
 * nanocoder publishes through its own release workflow (it needs fetch-depth 0,
 * a credits build and a contributors section the shared one does not carry), so
 * it invokes this path directly. It is otherwise identical to
 * Nano-Collective/.github scripts/extract-changelog.mjs — keep them in step.
 *
 * Resolves against the current working directory, which is the repository root
 * when the release workflow runs it.
 *
 * **Boundaries are found by walking lines, not by one big regex.** The previous
 * version terminated its capture at `(?=\n##+ )`, which also matches `###`. A
 * changesets changelog opens every version with `### Patch Changes`, so the
 * lookahead fired on the very first line of the body, the capture came back
 * empty, and the script exited 0 having printed nothing. Every release across
 * every repo shipped with a blank body and no error anywhere to say so.
 *
 * Walking lines also means the version is never interpolated into a pattern, so
 * the regex-injection this script used to carry cannot come back.
 */

import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const rootDir = process.env.CHANGELOG_ROOT ?? process.cwd();

let version = process.argv[2];
if (!version) {
	try {
		version = JSON.parse(
			readFileSync(join(rootDir, 'package.json'), 'utf-8'),
		).version;
	} catch (error) {
		console.error(
			`Could not read a version from ${join(rootDir, 'package.json')}: ${error.message}`,
		);
		process.exit(1);
	}
}

let changelogContent;
try {
	changelogContent = readFileSync(join(rootDir, 'CHANGELOG.md'), 'utf-8');
} catch (error) {
	console.error(`Error reading CHANGELOG.md: ${error.message}`);
	process.exit(1);
}

/** `## [1.2.3] - 2026-01-01` -> {depth: 2, title: "[1.2.3] - 2026-01-01"} */
function parseHeading(line) {
	const match = /^(#{1,6})\s+(.*)$/.exec(line);
	return match ? {depth: match[1].length, title: match[2].trim()} : null;
}

/**
 * Whether a heading announces this version.
 *
 * Accepts `## 1.2.3`, `## [1.2.3]`, and `## [1.2.3] - 2026-01-01`, which covers
 * what changesets writes and the Keep a Changelog convention. Compared as
 * strings rather than matched as a pattern.
 */
function announcesVersion(title) {
	const firstToken = title.split(/\s+/)[0] ?? '';
	const bare = firstToken.replace(/^\[/, '').replace(/\]$/, '');
	return bare === version;
}

const lines = changelogContent.split('\n');
const startIndex = lines.findIndex(line => {
	const heading = parseHeading(line);
	return heading !== null && announcesVersion(heading.title);
});

if (startIndex === -1) {
	console.error(`No changelog entry found for version ${version}`);
	console.error('Expected a heading in CHANGELOG.md such as:');
	console.error(`  ## ${version}`);
	console.error(`  ## [${version}] - YYYY-MM-DD`);
	process.exit(1);
}

// The section runs until the next heading at the same level or shallower.
// Deeper headings — `### Patch Changes` and friends — are part of the body.
const startDepth = parseHeading(lines[startIndex]).depth;
let endIndex = lines.length;
for (let i = startIndex + 1; i < lines.length; i++) {
	const heading = parseHeading(lines[i]);
	if (heading !== null && heading.depth <= startDepth) {
		endIndex = i;
		break;
	}
}

const body = lines
	.slice(startIndex + 1, endIndex)
	.join('\n')
	.trim();

if (body.length === 0) {
	// Distinct from "no entry found", and worth its own message: a version whose
	// section exists but is empty is a changelog problem, not a lookup failure.
	console.error(`The changelog entry for ${version} is empty`);
	process.exit(1);
}

console.log(body);
