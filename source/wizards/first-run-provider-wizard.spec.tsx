import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout} from 'node:timers/promises';
import test, {type ExecutionContext} from 'ava';
import React from 'react';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import {FirstRunProviderWizard} from './first-run-provider-wizard';

function useTempConfig(t: ExecutionContext) {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-provider-wizard-'));
	const previous = process.env.NANOCODER_CONFIG_DIR;
	process.env.NANOCODER_CONFIG_DIR = dir;
	t.teardown(() => {
		if (previous === undefined) delete process.env.NANOCODER_CONFIG_DIR;
		else process.env.NANOCODER_CONFIG_DIR = previous;
		rmSync(dir, {recursive: true, force: true});
	});
	return {dir, configPath: join(dir, 'agents.config.json')};
}

async function waitFor(predicate: () => boolean) {
	const deadline = Date.now() + 3000;
	while (!predicate()) {
		if (Date.now() >= deadline)
			throw new Error('Timed out waiting for provider setup');
		await setTimeout(20);
	}
}

test.serial(
	'first-run setup shows key names and saves the generated config only after selection',
	async t => {
		const {dir, configPath} = useTempConfig(t);
		let completedPath: string | undefined;
		const {lastFrame, stdin, unmount} = renderWithTheme(
			<FirstRunProviderWizard
				projectDir={dir}
				onComplete={path => {
					completedPath = path;
				}}
				onCancel={() => t.fail('Setup was cancelled')}
				detectProviders={async () => [
					{
						config: {
							name: 'Groq',
							models: ['test-model'],
							apiKey: '${GROQ_API_KEY}',
						},
						keyVariable: 'GROQ_API_KEY',
					},
				]}
			/>,
		);
		t.teardown(unmount);
		await waitFor(() => lastFrame()?.includes('GROQ_API_KEY set') === true);
		t.false(existsSync(configPath));
		stdin.write('\r');
		await waitFor(() => completedPath !== undefined);
		t.is(completedPath, configPath);
		t.is(
			JSON.parse(readFileSync(configPath, 'utf8')).nanocoder.providers[0]
				.apiKey,
			'${GROQ_API_KEY}',
		);
	},
);

test.serial(
	'an existing config opens the regular wizard without discovery',
	t => {
		const {dir, configPath} = useTempConfig(t);
		writeFileSync(configPath, '{"nanocoder":{"maxTurns":3}}');
		const {lastFrame, unmount} = renderWithTheme(
			<FirstRunProviderWizard
				projectDir={dir}
				onComplete={() => t.fail('Existing config should not be written')}
				onCancel={() => {}}
				detectProviders={async () => {
					t.fail('Existing configs should skip discovery');
					return [];
				}}
			/>,
		);
		t.teardown(unmount);
		t.regex(lastFrame() ?? '', /Provider Wizard/);
	},
);

test.serial(
	'first-run setup falls back to the regular wizard when nothing is detected',
	async t => {
		const {dir, configPath} = useTempConfig(t);
		const {lastFrame, unmount} = renderWithTheme(
			<FirstRunProviderWizard
				projectDir={dir}
				onComplete={() => t.fail('Empty results should not produce a config')}
				onCancel={() => {}}
				detectProviders={async () => []}
			/>,
		);
		t.teardown(unmount);
		await waitFor(() => lastFrame()?.includes('Provider Wizard') === true);
		t.false(existsSync(configPath));
	},
);
