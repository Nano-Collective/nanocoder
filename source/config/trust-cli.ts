/**
 * CLI surface for `nanocoder trust`. Lets a client check a folder's trust and
 * save it for the fingerprint it showed the user, without starting Nanocoder
 * in that folder: nothing the folder defines is loaded or run.
 *
 * Follows `config/config-cli.ts`: the handler returns an `{exitCode, output}`
 * pair and `cli.tsx` decides which stream to print it on.
 */

import {
	grantDirectoryTrust,
	isDirectoryTrusted,
	loadGlobalOnlyPreferences,
	saveGlobalOnlyPreferences,
	trustRecheck,
} from '@/config/preferences';
import {describeProjectTrust} from '@/config/project-trust';

interface TrustCliResult {
	exitCode: 0 | 1;
	output: string;
}

type TrustStatus = 'trusted' | 'not-trusted' | 'changed' | 'needs-re-approval';

const TRUST_CLI_USAGE = `Usage: nanocoder trust --status [--json]
       nanocoder trust --grant <fingerprint>

Checks or saves trust for the current folder. Nothing the folder defines is
loaded or run.

Options:
  --status             Show whether the folder is trusted (trusted, not-trusted,
                       changed or needs-re-approval), what it will run, and its
                       fingerprint
  --grant <fingerprint>
                       Trust the folder only if its fingerprint still matches
                       <fingerprint>. Fails if the folder changed since then.
  --json               Emit machine-readable JSON with --status`;

/**
 * Always about the current folder. The trust list is read from and written to
 * the global preferences file only: a preferences file in the folder is never
 * opened, so it can neither hide the list nor be changed by granting trust.
 */
export function runTrustCli(args: readonly string[]): TrustCliResult {
	const cwd = process.cwd();
	const rest = args.filter(arg => arg !== '--json');
	const jsonFlags = args.length - rest.length;

	// `--json` only applies to --status, and only once.
	if (rest.length === 1 && rest[0] === '--status' && jsonFlags <= 1) {
		return status(cwd, jsonFlags === 1);
	}
	if (rest.length === 2 && rest[0] === '--grant' && jsonFlags === 0) {
		return grant(cwd, rest[1]);
	}
	const help = args.length === 0 || args[0] === '--help' || args[0] === '-h';
	return {
		exitCode: help ? 0 : 1,
		output: help
			? TRUST_CLI_USAGE
			: `Invalid trust arguments: ${args.join(' ')}\n\n${TRUST_CLI_USAGE}`,
	};
}

function status(cwd: string, json: boolean): TrustCliResult {
	const preferences = loadGlobalOnlyPreferences();
	const {fingerprint, summary} = describeProjectTrust(cwd);
	const recheck = trustRecheck(cwd, preferences);
	const trustStatus: TrustStatus = isDirectoryTrusted(cwd, preferences)
		? 'trusted'
		: recheck === 'changed'
			? 'changed'
			: recheck === 'upgrade'
				? 'needs-re-approval'
				: 'not-trusted';

	if (json) {
		return {
			exitCode: 0,
			output: JSON.stringify(
				{path: cwd, status: trustStatus, summary, fingerprint},
				null,
				2,
			),
		};
	}
	return {
		exitCode: 0,
		output: [
			`Directory: ${cwd}`,
			`Status: ${trustStatus}`,
			summary ?? 'This folder contains nothing that Nanocoder runs.',
			`Fingerprint: ${fingerprint}`,
		].join('\n'),
	};
}

function grant(cwd: string, fingerprint: string): TrustCliResult {
	const current = describeProjectTrust(cwd).fingerprint;
	if (current !== fingerprint) {
		return {
			exitCode: 1,
			output: `Not trusted: ${cwd} changed since that fingerprint was taken. Run "nanocoder trust --status" and review it again.`,
		};
	}
	const {trustedDirectories} = grantDirectoryTrust(
		loadGlobalOnlyPreferences(),
		cwd,
		current,
	);
	if (!saveGlobalOnlyPreferences({trustedDirectories})) {
		return {exitCode: 1, output: `Could not save trust for ${cwd}.`};
	}
	return {exitCode: 0, output: `Trusted ${cwd}.`};
}
