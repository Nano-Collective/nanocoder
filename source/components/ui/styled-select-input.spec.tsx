import test from 'ava';
import {Text} from 'ink';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import React from 'react';
import {StyledSelectInput} from '@/components/ui/styled-select-input';
import {renderWithTheme} from '@/test-utils/render-with-theme';

const items = [
	{label: 'First option', value: 'first'},
	{label: 'Second option', value: 'second'},
];

test('StyledSelectInput marks the highlighted row with the "> " indicator', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<StyledSelectInput items={items} onSelect={() => {}} />,
	);

	const lines = (lastFrame() ?? '').split('\n');
	t.regex(lines[0] ?? '', /^>\s+First option/);
	t.regex(lines[1] ?? '', /^\s+Second option/);
	unmount();
});

test('StyledSelectInput forwards initialIndex to the highlighted row', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<StyledSelectInput items={items} initialIndex={1} onSelect={() => {}} />,
	);

	const lines = (lastFrame() ?? '').split('\n');
	t.regex(lines[1] ?? '', /^>\s+Second option/);
	unmount();
});

test('StyledSelectInput keeps the themed indicator for a custom itemComponent', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<StyledSelectInput
			items={items}
			onSelect={() => {}}
			itemComponent={({label}) => <Text>{label.toUpperCase()}</Text>}
		/>,
	);

	const lines = (lastFrame() ?? '').split('\n');
	t.regex(lines[0] ?? '', /^>\s+FIRST OPTION/);
	unmount();
});

// ink-select-input's built-in Indicator/ItemComponent hardcode `color="blue"`,
// which is near-illegible on a dark terminal and ignores the active theme
// (issue #827). StyledSelectInput is the only sanctioned entry point.
test('ink-select-input is imported only by StyledSelectInput', t => {
	const wrapper = join('source', 'components', 'ui', 'styled-select-input.tsx');
	const offenders: string[] = [];

	const walk = (dir: string) => {
		for (const entry of readdirSync(dir)) {
			const path = join(dir, entry);
			if (statSync(path).isDirectory()) {
				walk(path);
				continue;
			}
			if (!/\.tsx?$/.test(path) || /\.spec\.tsx?$/.test(path)) continue;
			if (path === wrapper) continue;
			if (readFileSync(path, 'utf-8').includes("from 'ink-select-input'")) {
				offenders.push(path);
			}
		}
	};
	walk('source');

	t.deepEqual(
		offenders,
		[],
		`import StyledSelectInput instead of SelectInput in: ${offenders.join(', ')}`,
	);
});
