import test from 'ava';
import {Text} from 'ink';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import React from 'react';
import stripAnsi from 'strip-ansi';
import {StyledSelectInput} from '@/components/ui/styled-select-input';
import {renderWithTheme} from '@/test-utils/render-with-theme';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const items = [
	{label: 'First option', value: 'first'},
	{label: 'Second option', value: 'second'},
];

const threeItems = [
	{label: 'First option', value: 'first'},
	{label: 'Second option', value: 'second'},
	{label: 'Third option', value: 'third'},
];

test('StyledSelectInput marks the highlighted row with the "> " indicator', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<StyledSelectInput items={items} onSelect={() => {}} />,
	);

	const lines = stripAnsi(lastFrame() ?? '').split('\n');
	t.regex(lines[0] ?? '', /^>\s+First option/);
	t.regex(lines[1] ?? '', /^\s+Second option/);
	unmount();
});

test('StyledSelectInput forwards initialIndex to the highlighted row', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<StyledSelectInput items={items} initialIndex={1} onSelect={() => {}} />,
	);

	const lines = stripAnsi(lastFrame() ?? '').split('\n');
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

	const lines = stripAnsi(lastFrame() ?? '').split('\n');
	t.regex(lines[0] ?? '', /^>\s+FIRST OPTION/);
	unmount();
});

// ink-select-input's built-in Indicator/ItemComponent hardcode `color="blue"`
// (issue #827) and its input handler reads stale render state when arrow +
// Enter arrive in one stdin chunk (issue #2406). StyledSelectInput is the
// local replacement and ink-select-input must not be imported anywhere.
test('ink-select-input is not imported anywhere in source', t => {
	const offenders: string[] = [];

	const walk = (dir: string) => {
		for (const entry of readdirSync(dir)) {
			const path = join(dir, entry);
			if (statSync(path).isDirectory()) {
				walk(path);
				continue;
			}
			if (!/\.tsx?$/.test(path) || /\.spec\.tsx?$/.test(path)) continue;
			if (readFileSync(path, 'utf-8').includes("from 'ink-select-input'")) {
				offenders.push(path);
			}
		}
	};
	walk('source');

	t.deepEqual(
		offenders,
		[],
		`import StyledSelectInput instead of ink-select-input in: ${offenders.join(', ')}`,
	);
});

test('StyledSelectInput selects the second item when Down and Enter arrive in one input chunk', async t => {
	const selected: string[] = [];
	const {stdin, unmount} = renderWithTheme(
		<StyledSelectInput
			items={items}
			onSelect={item => selected.push(item.value)}
		/>,
	);
	t.teardown(() => unmount());

	await sleep(50);
	stdin.write('\u001B[B\r');
	await sleep(50);

	t.deepEqual(selected, ['second']);
});

test('StyledSelectInput applies multiple arrows and Enter in one input chunk', async t => {
	const selected: string[] = [];
	const {stdin, unmount} = renderWithTheme(
		<StyledSelectInput
			items={threeItems}
			onSelect={item => selected.push(item.value)}
		/>,
	);
	t.teardown(() => unmount());

	await sleep(50);
	stdin.write('\u001B[B\u001B[B\r');
	await sleep(50);

	t.deepEqual(selected, ['third']);
});

test('StyledSelectInput navigates with separate Up/Down keypresses before Enter', async t => {
	const selected: string[] = [];
	const highlighted: string[] = [];
	const {stdin, lastFrame, unmount} = renderWithTheme(
		<StyledSelectInput
			items={threeItems}
			onHighlight={item => highlighted.push(item.value)}
			onSelect={item => selected.push(item.value)}
		/>,
	);
	t.teardown(() => unmount());

	await sleep(50);
	stdin.write('\u001B[B');
	await sleep(50);
	t.regex(
		stripAnsi(lastFrame() ?? '').split('\n')[1] ?? '',
		/^>\s+Second option/,
	);

	stdin.write('\u001B[B');
	await sleep(50);
	t.regex(
		stripAnsi(lastFrame() ?? '').split('\n')[2] ?? '',
		/^>\s+Third option/,
	);

	stdin.write('\u001B[A');
	await sleep(50);
	t.regex(
		stripAnsi(lastFrame() ?? '').split('\n')[1] ?? '',
		/^>\s+Second option/,
	);

	stdin.write('\r');
	await sleep(50);

	t.deepEqual(highlighted, ['second', 'third', 'second']);
	t.deepEqual(selected, ['second']);
});

test('StyledSelectInput scrolls and selects correctly when Down+Down+Enter arrive in one chunk with limit', async t => {
	const fourItems = [
		...threeItems,
		{label: 'Fourth option', value: 'fourth'},
	];
	const selected: string[] = [];
	const {stdin, unmount} = renderWithTheme(
		<StyledSelectInput
			items={fourItems}
			limit={2}
			onSelect={item => selected.push(item.value)}
		/>,
	);
	t.teardown(() => unmount());

	await sleep(50);
	stdin.write('\u001B[B\u001B[B\r');
	await sleep(50);

	t.deepEqual(selected, ['third']);
});

test('StyledSelectInput wraps to the last item when Up and Enter arrive in one input chunk', async t => {
	const selected: string[] = [];
	const {stdin, unmount} = renderWithTheme(
		<StyledSelectInput
			items={threeItems}
			onSelect={item => selected.push(item.value)}
		/>,
	);
	t.teardown(() => unmount());

	await sleep(50);
	stdin.write('\u001B[A\r');
	await sleep(50);

	t.deepEqual(selected, ['third']);
});

test('StyledSelectInput ignores input when isFocused is false', async t => {
	const selected: string[] = [];
	const {stdin, unmount} = renderWithTheme(
		<StyledSelectInput
			items={items}
			isFocused={false}
			onSelect={item => selected.push(item.value)}
		/>,
	);
	t.teardown(() => unmount());

	await sleep(50);
	stdin.write('\u001B[B\r');
	await sleep(50);

	t.deepEqual(selected, []);
});

test('StyledSelectInput supports direct selection via number keys', async t => {
	const selected: string[] = [];
	const {stdin, unmount} = renderWithTheme(
		<StyledSelectInput
			items={threeItems}
			onSelect={item => selected.push(item.value)}
		/>,
	);
	t.teardown(() => unmount());

	await sleep(50);
	stdin.write('2');
	await sleep(50);

	t.deepEqual(selected, ['second']);
});
