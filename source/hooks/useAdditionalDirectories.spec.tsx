import {mkdtempSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {loadPreferences, resetPreferencesCache} from '@/config/preferences';
import {isDirectoryTrusted} from '@/config/trust/directory-trust';
import {describeProjectTrust} from '@/config/trust/project-trust';
import {resetSessionCwd} from '@/services/session-cwd';
import {
	getWorkingDirectories,
	setCliDirectories,
} from '@/services/working-directories';
import {useAdditionalDirectories} from './useAdditionalDirectories';

const flush = () => new Promise(resolve => setTimeout(resolve, 30));

test.serial(
	'startup gates every added root and persists each fingerprint separately',
	async t => {
		const root = mkdtempSync(join(tmpdir(), 'nano-add-startup-'));
		const extra = join(root, 'extra');
		const docs = join(root, 'docs');
		mkdirSync(extra);
		mkdirSync(docs);
		const cwd = process.cwd();
		const previous = process.env.NANOCODER_CONFIG_DIR;
		const trustEnv = process.env.NANOCODER_TRUST_DIRECTORY;
		process.chdir(root);
		process.env.NANOCODER_CONFIG_DIR = join(root, 'config');
		delete process.env.NANOCODER_TRUST_DIRECTORY;
		resetPreferencesCache();
		resetSessionCwd();
		setCliDirectories([{path: extra}, {path: docs, mode: 'read-only'}]);
		let current: ReturnType<typeof useAdditionalDirectories>;
		function TestComponent({trusted}: {trusted: boolean}) {
			current = useAdditionalDirectories(trusted, false);
			return null;
		}
		const instance = render(<TestComponent trusted={false} />);
		t.teardown(() => {
			instance.unmount();
			process.chdir(cwd);
			if (previous === undefined) delete process.env.NANOCODER_CONFIG_DIR;
			else process.env.NANOCODER_CONFIG_DIR = previous;
			if (trustEnv !== undefined)
				process.env.NANOCODER_TRUST_DIRECTORY = trustEnv;
			resetPreferencesCache();
			resetSessionCwd();
			rmSync(root, {recursive: true, force: true});
		});
		await flush();
		t.false(current!.ready);
		t.is(getWorkingDirectories().length, 1);
		instance.rerender(<TestComponent trusted />);
		await flush();
		t.is(current!.pending?.path, extra);
		t.is(getWorkingDirectories().length, 1);
		current!.confirm(describeProjectTrust(extra).fingerprint);
		await flush();
		t.is(current!.pending?.path, docs);
		t.false(current!.ready);
		current!.confirm(describeProjectTrust(docs).fingerprint);
		await flush();
		t.true(current!.ready);
		t.is(current!.pending, null);
		t.true(isDirectoryTrusted(extra, loadPreferences()));
		t.true(isDirectoryTrusted(docs, loadPreferences()));
		t.deepEqual(
			getWorkingDirectories()
				.slice(1)
				.map(directory => directory.mode),
			['read-write', 'read-only'],
		);
	},
);
