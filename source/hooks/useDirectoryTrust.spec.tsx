import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {
	isDirectoryTrusted,
	loadPreferences,
	resetPreferencesCache,
	savePreferences,
} from '@/config/preferences';
import {useDirectoryTrust} from './useDirectoryTrust';

console.log('\nuseDirectoryTrust.spec.tsx');

// Point preferences at a throwaway config dir, with a throwaway project root.
async function withIsolatedPreferences(
	fn: (root: string) => Promise<void>,
): Promise<void> {
	const configDir = await mkdtemp(join(tmpdir(), 'directory-trust-prefs-'));
	const root = await mkdtemp(join(tmpdir(), 'directory-trust-root-'));
	const previous = process.env.NANOCODER_CONFIG_DIR;
	process.env.NANOCODER_CONFIG_DIR = configDir;
	resetPreferencesCache();
	try {
		await fn(root);
	} finally {
		if (previous === undefined) delete process.env.NANOCODER_CONFIG_DIR;
		else process.env.NANOCODER_CONFIG_DIR = previous;
		resetPreferencesCache();
		await rm(configDir, {recursive: true, force: true});
		await rm(root, {recursive: true, force: true});
	}
}

function mountHook(directory: string) {
	const hook: {current?: ReturnType<typeof useDirectoryTrust>} = {};
	function TestComponent() {
		hook.current = useDirectoryTrust(directory);
		return null;
	}
	const instance = render(<TestComponent />);
	return {hook, unmount: instance.unmount};
}

// The same directory spelled un-normalized. Built by concatenation because
// path.join would normalize the `..` away.
const unnormalized = (root: string) => `${root}${sep}sub${sep}..`;

const flush = () => new Promise(resolve => setTimeout(resolve, 30));

// Serial: each test swaps the process-wide NANOCODER_CONFIG_DIR.
test.serial('reports trust exactly as isDirectoryTrusted does', async t => {
	const cases: Array<{label: string; stored: (root: string) => string[]}> = [
		{label: 'no entries', stored: () => []},
		{label: 'exact entry', stored: root => [root]},
		{label: 'un-normalized entry', stored: root => [unnormalized(root)]},
		{label: 'unrelated entry', stored: root => [join(root, 'elsewhere')]},
	];

	for (const {label, stored} of cases) {
		await withIsolatedPreferences(async root => {
			savePreferences({trustedDirectories: stored(root)});
			resetPreferencesCache();

			const {hook, unmount} = mountHook(root);
			t.is(
				hook.current?.isTrusted,
				isDirectoryTrusted(root, loadPreferences()),
				`${label}: the hook must agree with isDirectoryTrusted`,
			);
			t.is(hook.current?.isTrustedError, null);
			unmount();
		});
	}
});

test.serial(
	'handleConfirmTrust persists the normalized directory when untrusted',
	async t => {
		await withIsolatedPreferences(async root => {
			const {hook, unmount} = mountHook(unnormalized(root));
			t.false(hook.current?.isTrusted);

			hook.current?.handleConfirmTrust();
			await flush();

			t.true(hook.current?.isTrusted);
			unmount();
			resetPreferencesCache();
			t.deepEqual(loadPreferences().trustedDirectories, [resolve(root)]);
		});
	},
);

test.serial(
	'handleConfirmTrust does not add an entry for an already-trusted directory',
	async t => {
		await withIsolatedPreferences(async root => {
			// Stored in a form only the shared resolution rule recognises: an
			// exact-string check would miss it and append a duplicate entry.
			const stored = unnormalized(root);
			savePreferences({trustedDirectories: [stored]});
			resetPreferencesCache();

			const {hook, unmount} = mountHook(root);
			t.true(hook.current?.isTrusted);

			hook.current?.handleConfirmTrust();
			await flush();

			unmount();
			resetPreferencesCache();
			t.deepEqual(loadPreferences().trustedDirectories, [stored]);
		});
	},
);
