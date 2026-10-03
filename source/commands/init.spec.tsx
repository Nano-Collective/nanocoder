import test from 'ava';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '@/config/themes';
import {ThemeContext} from '@/hooks/useTheme';
import {TitleShapeContext} from '@/hooks/useTitleShape';
import {initCommand} from './init.js';

function Providers({children}: {children: React.ReactNode}) {
	return (
		<ThemeContext.Provider
			value={{
				currentTheme: 'tokyo-night',
				colors: themes['tokyo-night'].colors,
				setCurrentTheme: () => {},
			}}
		>
			<TitleShapeContext.Provider
				value={{
					currentTitleShape: 'pill',
					setCurrentTitleShape: () => {},
					commitTitleShape: () => {},
				}}
			>
				{children}
			</TitleShapeContext.Provider>
		</ThemeContext.Provider>
	);
}

test.serial('init success renders the selected preset and preserved files', async t => {
	const originalCwd = process.cwd();
	const projectPath = mkdtempSync(join(tmpdir(), 'nanocoder-init-render-'));
	try {
		writeFileSync(join(projectPath, '.nanocoderignore'), 'keep-me\n');
		writeFileSync(
			join(projectPath, 'package.json'),
			JSON.stringify({scripts: {build: 'vite build'}}),
		);
		process.chdir(projectPath);

		const result = await initCommand.handler(['--preset', 'react'], [], {
			provider: 'test',
			model: 'test',
			tokens: 0,
			getMessageTokens: () => 0,
		});
		if (!React.isValidElement(result)) {
			t.fail('Expected InitSuccess to return a React element');
			return;
		}

		const {lastFrame, unmount} = render(<Providers>{result}</Providers>);
		const output = lastFrame();
		unmount();

		t.truthy(output);
		t.true(output?.includes('Preset: react'));
		t.true(output?.includes('Existing Files Preserved:'));
		t.true(output?.includes('.nanocoderignore'));
	} finally {
		process.chdir(originalCwd);
		rmSync(projectPath, {recursive: true, force: true});
	}
});
