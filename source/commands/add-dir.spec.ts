import {mkdtempSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import type React from 'react';
import {resetPreferencesCache} from '@/config/preferences';
import {describeProjectTrust} from '@/config/trust/project-trust';
import {resetSessionCwd, setProjectRoot} from '@/services/session-cwd';
import {getWorkingDirectories} from '@/services/working-directories';
import type {CommandContext} from '@/types/commands';
import {addDirCommand} from './add-dir';

test.serial(
	'/add-dir accepts quoted paths and grants nothing until confirmed',
	async t => {
		const root = mkdtempSync(join(tmpdir(), 'nano-add-command-'));
		const extra = join(root, 'shared library');
		mkdirSync(extra);
		const previous = process.env.NANOCODER_CONFIG_DIR;
		const trustEnv = process.env.NANOCODER_TRUST_DIRECTORY;
		process.env.NANOCODER_CONFIG_DIR = join(root, 'config');
		delete process.env.NANOCODER_TRUST_DIRECTORY;
		resetPreferencesCache();
		setProjectRoot(root);
		t.teardown(() => {
			if (previous === undefined) delete process.env.NANOCODER_CONFIG_DIR;
			else process.env.NANOCODER_CONFIG_DIR = previous;
			if (trustEnv !== undefined)
				process.env.NANOCODER_TRUST_DIRECTORY = trustEnv;
			resetPreferencesCache();
			resetSessionCwd();
			rmSync(root, {recursive: true, force: true});
		});
		let live: React.ReactNode;
		let captures = false;
		const context = {
			argText: '--read-only "shared library"',
			args: ['--read-only', '"shared', 'library"'],
			setLiveComponent: (component: React.ReactNode) => {
				live = component;
			},
			setLiveComponentCapturesInput: (value: boolean) => {
				captures = value;
			},
			addToChatQueue: () => {},
		} as unknown as CommandContext;
		const result = await addDirCommand.run(context);
		t.is(getWorkingDirectories().length, 1);
		t.true(captures);
		const prompt = live as React.ReactElement<{
			onConfirm: (fingerprint: string) => void;
		}>;
		prompt.props.onConfirm(describeProjectTrust(extra).fingerprint);
		if (typeof result === 'object' && 'until' in result) await result.until;
		t.false(captures);
		t.is(live, null);
		t.deepEqual(getWorkingDirectories().slice(1), [
			{path: extra, mode: 'read-only'},
		]);
	},
);

test.serial(
	'/add-dir cancellation leaves the active roots unchanged',
	async t => {
		const root = mkdtempSync(join(tmpdir(), 'nano-add-cancel-'));
		const previous = process.env.NANOCODER_CONFIG_DIR;
		process.env.NANOCODER_CONFIG_DIR = join(root, 'config');
		resetPreferencesCache();
		t.teardown(() => {
			if (previous === undefined) delete process.env.NANOCODER_CONFIG_DIR;
			else process.env.NANOCODER_CONFIG_DIR = previous;
			resetPreferencesCache();
			resetSessionCwd();
			rmSync(root, {recursive: true, force: true});
		});
		let live: React.ReactNode;
		const context = {
			argText: root,
			args: [root],
			setLiveComponent: (component: React.ReactNode) => {
				live = component;
			},
			setLiveComponentCapturesInput: () => {},
			addToChatQueue: () => {},
		} as unknown as CommandContext;
		const result = await addDirCommand.run(context);
		(live as React.ReactElement<{onExit: () => void}>).props.onExit();
		if (typeof result === 'object' && 'until' in result) await result.until;
		t.is(getWorkingDirectories().length, 1);
	},
);
