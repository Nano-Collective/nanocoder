#!/usr/bin/env node

/**
 * Validate that every changeset names a real workspace package.
 *
 * `.changeset/*.md` files declare their target in YAML frontmatter:
 *
 *   ---
 *   "@nanocollective/nanocoder": patch
 *   ---
 *
 * A name that does not resolve to a workspace package is accepted by the PR
 * checks and then breaks `release-prepare` on every subsequent push to main
 * with "Found changeset <slug> for package <name> which is not in the
 * workspace". The Version Packages PR stops updating and no release can be
 * cut until someone notices. #1065 did exactly that.
 *
 * Deliberately narrower than `changeset status`, which also exits 1 when
 * packages changed but no changeset was added. That is a policy this repo
 * does not want enforced - `changeset-check.yml` is a non-blocking nudge on
 * purpose - and it additionally needs a local `main` ref, which CI's detached
 * checkout does not have.
 *
 * Empty changesets (`changeset add --empty`, the chore convention) declare no
 * packages and are valid.
 */

import {readdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Package names declared anywhere in the pnpm workspace. */
function workspacePackageNames() {
	const names = new Set();
	const add = manifestPath => {
		try {
			const {name} = JSON.parse(readFileSync(manifestPath, 'utf8'));
			if (name) names.add(name);
		} catch {
			// A workspace entry without a readable manifest is not our concern.
		}
	};

	add(join(root, 'package.json'));

	const pluginsDir = join(root, 'plugins');
	let plugins = [];
	try {
		plugins = readdirSync(pluginsDir, {withFileTypes: true})
			.filter(entry => entry.isDirectory())
			.map(entry => entry.name);
	} catch {
		// No plugins directory - the root package is the whole workspace.
	}
	for (const plugin of plugins) {
		add(join(pluginsDir, plugin, 'package.json'));
	}

	return names;
}

/**
 * Package names declared in one changeset's frontmatter.
 *
 * The frontmatter is the block between the first two `---` fences. Entries are
 * `"name": bump`; the name may be quoted with single or double quotes, or bare.
 */
function declaredPackages(contents) {
	const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n?---/);
	if (!match) return [];

	return match[1]
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(line => line && !line.startsWith('#'))
		.map(line => line.match(/^(?:"([^"]+)"|'([^']+)'|([^:]+?))\s*:/))
		.filter(Boolean)
		.map(parts => (parts[1] ?? parts[2] ?? parts[3]).trim());
}

const changesetDir = join(root, '.changeset');
const known = workspacePackageNames();
const problems = [];

const files = readdirSync(changesetDir)
	.filter(file => file.endsWith('.md') && file !== 'README.md')
	.sort();

for (const file of files) {
	const contents = readFileSync(join(changesetDir, file), 'utf8');
	for (const name of declaredPackages(contents)) {
		if (!known.has(name)) {
			problems.push({file, name});
		}
	}
}

if (problems.length > 0) {
	console.error('Changesets naming packages that are not in the workspace:\n');
	for (const {file, name} of problems) {
		console.error(`  .changeset/${file} declares "${name}"`);
	}
	console.error(
		`\nWorkspace packages: ${[...known].sort().join(', ')}` +
			'\n\nThis would break `changeset version` on main. Fix the package name.',
	);
	process.exit(1);
}

console.log(
	`Checked ${files.length} changeset${files.length === 1 ? '' : 's'}; ` +
		'every declared package resolves.',
);
