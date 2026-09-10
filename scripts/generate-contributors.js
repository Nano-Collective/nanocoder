#!/usr/bin/env node

/**
 * Build the "Contributors" section for a GitHub release body.
 *
 * The release notes themselves come from CHANGELOG.md (see extract-changelog.js),
 * which only credits people when whoever wrote the changeset remembered to type
 * "Thanks to @someone". This script credits everyone instead, by asking GitHub's
 * own release-notes generator who authored the pull requests in the tag range.
 *
 * Usage:
 *   node scripts/generate-contributors.js --tag v1.31.0 [--previous-tag v1.30.0] [--target <sha>]
 *
 * Requires GITHUB_TOKEN and GITHUB_REPOSITORY in the environment.
 *
 * Prints the markdown section to stdout, or nothing at all if the contributor
 * list could not be determined. Always exits 0 - a release must not fail
 * because the credits could not be built.
 */

const API = 'https://api.github.com';

/** Accounts that author PRs but are not people. */
const BOT_LOGINS = new Set([
	'changeset-bot',
	'dependabot',
	'dependabot-preview',
	'github-actions',
	'renovate',
]);

function isBot(login) {
	return login.endsWith('[bot]') || BOT_LOGINS.has(login.toLowerCase());
}

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i += 2) {
		const key = argv[i]?.replace(/^--/, '');
		if (key) args[key] = argv[i + 1];
	}
	return args;
}

async function api(path, token, init = {}) {
	const response = await fetch(`${API}${path}`, {
		...init,
		headers: {
			accept: 'application/vnd.github+json',
			authorization: `Bearer ${token}`,
			'x-github-api-version': '2022-11-28',
			...(init.body ? {'content-type': 'application/json'} : {}),
		},
	});
	if (!response.ok) {
		throw new Error(
			`${init.method ?? 'GET'} ${path} failed: ${response.status} ${response.statusText}`,
		);
	}
	return response.json();
}

async function tagExists(repo, tag, token) {
	try {
		await api(`/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`, token);
		return true;
	} catch {
		return false;
	}
}

/**
 * Pull the PR authors and first-time contributors out of GitHub's generated
 * release notes. The generator emits lines shaped like:
 *   * Some change by @octocat in https://github.com/owner/repo/pull/1
 *   * @octocat made their first contribution in https://github.com/owner/repo/pull/1
 */
function parseContributors(notes) {
	const authors = new Set();
	const firstTimers = new Set();

	for (const [, login] of notes.matchAll(/ by @([A-Za-z0-9-]+) in https/g)) {
		if (!isBot(login)) authors.add(login);
	}
	for (const [, login] of notes.matchAll(
		/@([A-Za-z0-9-]+) made their first contribution/g,
	)) {
		if (!isBot(login)) {
			authors.add(login);
			firstTimers.add(login);
		}
	}

	const byName = (a, b) => a.toLowerCase().localeCompare(b.toLowerCase());
	return {
		authors: [...authors].sort(byName),
		firstTimers: [...firstTimers].sort(byName),
	};
}

/** "a", "a and b", "a, b and c" */
function joinMentions(logins) {
	const mentions = logins.map(login => `@${login}`);
	if (mentions.length <= 1) return mentions.join('');
	return `${mentions.slice(0, -1).join(', ')} and ${mentions.at(-1)}`;
}

function formatSection({authors, firstTimers}) {
	if (authors.length === 0) return '';

	const lines = [
		'### Contributors',
		'',
		`This release shipped thanks to ${joinMentions(authors)}.`,
	];
	if (firstTimers.length > 0) {
		lines.push(
			'',
			`First-time contributors: ${joinMentions(firstTimers)}. Welcome, and thank you!`,
		);
	}
	return lines.join('\n');
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const token = process.env.GITHUB_TOKEN;
	const repo = process.env.GITHUB_REPOSITORY;

	if (!args.tag) throw new Error('--tag is required');
	if (!token) throw new Error('GITHUB_TOKEN is not set');
	if (!repo) throw new Error('GITHUB_REPOSITORY is not set');

	const body = {tag_name: args.tag};
	// Required when --tag does not exist yet, which is the case during a release:
	// the tag is created by the step that publishes the release.
	if (args.target) body.target_commitish = args.target;
	// Left unset if the previous tag is missing (first release, or a version
	// published to NPM without a matching tag) so GitHub picks the range itself.
	if (
		args['previous-tag'] &&
		(await tagExists(repo, args['previous-tag'], token))
	) {
		body.previous_tag_name = args['previous-tag'];
	}

	const notes = await api(`/repos/${repo}/releases/generate-notes`, token, {
		method: 'POST',
		body: JSON.stringify(body),
	});

	const section = formatSection(parseContributors(notes.body ?? ''));
	if (section) console.log(section);
	else console.error('No contributors found for this range; skipping section.');
}

main().catch(error => {
	console.error(`Could not build contributors section: ${error.message}`);
	process.exit(0);
});
