import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {loadAdditionalDirectoriesConfig, clearAppConfig} from './index';

test.serial(
	'additionalDirectories uses project-over-global configuration and normalizes shorthand',
	t => {
		const root = mkdtempSync(join(tmpdir(), 'nano-directories-config-'));
		const global = join(root, 'global');
		const project = join(root, 'project');
		mkdirSync(global);
		mkdirSync(project);
		const previous = process.env.NANOCODER_CONFIG_DIR;
		process.env.NANOCODER_CONFIG_DIR = global;
		clearAppConfig();
		t.teardown(() => {
			if (previous === undefined) delete process.env.NANOCODER_CONFIG_DIR;
			else process.env.NANOCODER_CONFIG_DIR = previous;
			clearAppConfig();
			rmSync(root, {recursive: true, force: true});
		});
		writeFileSync(
			join(global, 'agents.config.json'),
			JSON.stringify({nanocoder: {additionalDirectories: ['../global-lib']}}),
		);
		t.deepEqual(loadAdditionalDirectoriesConfig(project), [
			{path: '../global-lib'},
		]);
		writeFileSync(
			join(project, 'agents.config.json'),
			JSON.stringify({
				nanocoder: {
					additionalDirectories: [
						'../lib',
						{path: '../docs', mode: 'read-only'},
					],
				},
			}),
		);
		clearAppConfig();
		t.deepEqual(loadAdditionalDirectoriesConfig(project), [
			{path: '../lib'},
			{path: '../docs', mode: 'read-only'},
		]);
		writeFileSync(
			join(project, 'agents.config.json'),
			JSON.stringify({nanocoder: {additionalDirectories: []}}),
		);
		clearAppConfig();
		t.deepEqual(loadAdditionalDirectoriesConfig(project), []);
	},
);
