import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	isDirectoryTrusted,
	loadPreferences,
	resetPreferencesCache,
	savePreferences,
} from '@/config/preferences';
import React from 'react';
import {renderWithTheme} from '../test-utils/render-with-theme.js';
import {useDirectoryTrust} from './useDirectoryTrust';

/**
 * Ink has no renderHook helper in this repo; a probe component captures the
 * hook's latest return value on every render.
 */
function TrustProbe({
	directory,
	capture,
}: {
	directory: string;
	capture: (value: ReturnType<typeof useDirectoryTrust>) => void;
}) {
	const value = useDirectoryTrust(directory);
	capture(value);
	return null;
}

function makeCaptureElement(
	directory: string,
	capture: (value: ReturnType<typeof useDirectoryTrust>) => void,
) {
	return (
		<TrustProbe directory={directory} capture={capture} />
	);
}

// ink-testing-library commits frames asynchronously under React 19, so every
// read of the hook's value follows a rerender + a macrotask tick.
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 20));

async function renderTrustHook(directory: string) {
	let value: ReturnType<typeof useDirectoryTrust> | undefined;
	const {rerender} = renderWithTheme(
		makeCaptureElement(directory, v => {
			value = v;
		}),
		{withUIState: false},
	);
	await tick();

	const current = async () => {
		rerender(makeCaptureElement(directory, v => {
			value = v;
		}));
		await tick();
		return value!;
	};
	return {current};
}

console.log('\nuseDirectoryTrust.spec.tsx');

// Each test gets its own temp config dir so preference writes never leak
// between tests or into the developer's real preferences file.
async function withIsolatedConfig(
	fn: (configDir: string) => void | Promise<void>,
): Promise<void> {
	const configDir = mkdtempSync(join(tmpdir(), 'nc-trust-hook-'));
	const previous = process.env.NANOCODER_CONFIG_DIR;
	process.env.NANOCODER_CONFIG_DIR = configDir;
	resetPreferencesCache();
	delete process.env.NANOCODER_TRUST_DIRECTORY;
	try {
		await fn(configDir);
	} finally {
		if (previous === undefined) {
			delete process.env.NANOCODER_CONFIG_DIR;
		} else {
			process.env.NANOCODER_CONFIG_DIR = previous;
		}
		resetPreferencesCache();
		rmSync(configDir, {recursive: true, force: true});
	}
}

test('useDirectoryTrust - an untrusted directory reports not trusted', async t => {
	await withIsolatedConfig(async () => {
		const dir = mkdtempSync(join(tmpdir(), 'nc-untrusted-'));
		try {
			const {current} = await renderTrustHook(dir);
			t.false((await current()).isTrusted);
			t.is((await current()).isTrustedError, null);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	});
});

test('useDirectoryTrust - a persisted directory reports trusted', async t => {
	await withIsolatedConfig(async () => {
		const dir = mkdtempSync(join(tmpdir(), 'nc-trusted-'));
		try {
			const preferences = loadPreferences();
			preferences.trustedDirectories = [
				...(preferences.trustedDirectories ?? []),
				dir,
			];
			savePreferences(preferences);

			const {current} = await renderTrustHook(dir);
			t.true((await current()).isTrusted);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	});
});

test('useDirectoryTrust - handleConfirmTrust persists through the shared rule', async t => {
	await withIsolatedConfig(async () => {
		const dir = mkdtempSync(join(tmpdir(), 'nc-confirm-'));
		try {
			const {current} = await renderTrustHook(dir);
			t.false((await current()).isTrusted);

			(await current()).handleConfirmTrust();
			t.true(
				(await current()).isTrusted,
				'trusted immediately after confirm',
			);

			// The persisted entry must satisfy the SHARED isDirectoryTrusted
			// check — the whole point of issue #1339's unification.
			t.true(
				isDirectoryTrusted(dir, loadPreferences()),
				'persistence must go through the shared rule',
			);

			// Confirming twice must not duplicate the entry.
			(await current()).handleConfirmTrust();
			const stored = loadPreferences().trustedDirectories ?? [];
			t.is(stored.filter(d => d === dir).length, 1);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	});
});

test('useDirectoryTrust - NANOCODER_TRUST_DIRECTORY=1 marks any directory trusted', async t => {
	await withIsolatedConfig(async () => {
		const dir = mkdtempSync(join(tmpdir(), 'nc-envtrust-'));
		try {
			process.env.NANOCODER_TRUST_DIRECTORY = '1';
			resetPreferencesCache();
			const {current} = await renderTrustHook(dir);
			t.true(
				(await current()).isTrusted,
				'env bypass must apply through the shared helper',
			);
		} finally {
			delete process.env.NANOCODER_TRUST_DIRECTORY;
			rmSync(dir, {recursive: true, force: true});
		}
	});
});

test('useDirectoryTrust - env bypass stays ephemeral', async t => {
	await withIsolatedConfig(async () => {
		const dir = mkdtempSync(join(tmpdir(), 'nc-envtrust-ephemeral-'));
		mkdirSync(dir, {recursive: true});
		try {
			process.env.NANOCODER_TRUST_DIRECTORY = '1';
			const {current} = await renderTrustHook(dir);
			t.true((await current()).isTrusted);

			delete process.env.NANOCODER_TRUST_DIRECTORY;
			t.false(
				(loadPreferences().trustedDirectories ?? []).includes(dir),
				'the bypass must never write to preferences',
			);
		} finally {
			delete process.env.NANOCODER_TRUST_DIRECTORY;
			rmSync(dir, {recursive: true, force: true});
		}
	});
});
