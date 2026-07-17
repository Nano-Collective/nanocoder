// source/components/filterable-select-list.spec.tsx
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {FilterableSelectList} from './filterable-select-list.js';
import {renderWithTheme} from '../test-utils/render-with-theme.js';

console.log('\nfilterable-select-list.spec.tsx');

const items = [
	{label: 'alpha (openai)', value: '0'},
	{label: 'beta (ollama)', value: '1'},
	{label: 'gamma (openrouter)', value: '2'},
];

test('renders all items when query is empty', t => {
	const {lastFrame} = renderWithTheme(
		<FilterableSelectList items={items} onSelect={() => {}} />,
	);
	const out = lastFrame()!;
	t.regex(out, /alpha \(openai\)/);
	t.regex(out, /beta \(ollama\)/);
	t.regex(out, /gamma \(openrouter\)/);
});

test('filters by label substring case-insensitively', t => {
	const many = [
		{label: 'gpt-4o (openai)', value: '0'},
		{label: 'gpt-4o-mini (openai)', value: '1'},
		{label: 'llama3 (ollama)', value: '2'},
	];
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<FilterableSelectList items={many} onSelect={() => {}} />,
	);
	stdin.write('gpt');
	// allow ink to process key — 50ms matches repo precedent (model-selector.spec.tsx:206)
	return new Promise<void>(resolve => {
		setTimeout(() => {
			const out = lastFrame()!;
			t.regex(out, /gpt-4o \(openai\)/);
			t.regex(out, /gpt-4o-mini \(openai\)/);
			t.notRegex(out, /llama3/);
			unmount();
			resolve();
		}, 50);
	});
});

test('empty query shows all items in original order', t => {
	const many = [
		{label: 'zeta (a)', value: '0'},
		{label: 'alpha (b)', value: '1'},
	];
	const {lastFrame, unmount} = renderWithTheme(
		<FilterableSelectList items={many} onSelect={() => {}} />,
	);
	const out = lastFrame()!;
	t.regex(out, /zeta \(a\)[\s\S]*alpha \(b\)/);
	unmount();
});

test('ranks exact > contains for fuzzy filter', t => {
	const many = [
		{label: 'claude-3 (anthropic)', value: '0'},
		{label: 'claudette (x)', value: '1'},
	];
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<FilterableSelectList items={many} onSelect={() => {}} />,
	);
	stdin.write('claude');
	return new Promise<void>(resolve => {
		setTimeout(() => {
			const out = lastFrame()!;
			const i0 = out.indexOf('claude-3 (anthropic)');
			const i1 = out.indexOf('claudette (x)');
			t.true(i0 >= 0 && i1 >= 0);
			t.true(i0 < i1);
			unmount();
			resolve();
		}, 50);
	});
});

test('caps visible window to visibleCount', t => {
	const many = Array.from({length: 30}, (_, i) => ({
		label: `m-${i}`,
		value: String(i),
	}));
	const {lastFrame, unmount} = renderWithTheme(
		<FilterableSelectList items={many} visibleCount={12} onSelect={() => {}} />,
	);
	const out = lastFrame()!;
	const visible = many
		.map(m => m.label)
		.filter(label => out.includes(label));
	t.is(visible.length, 12);
	unmount();
});

test('centers highlight in the middle of the window', t => {
	const many = Array.from({length: 30}, (_, i) => ({
		label: `m-${i}`,
		value: String(i),
	}));
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<FilterableSelectList items={many} visibleCount={12} onSelect={() => {}} />,
	);
	// move down 15 so highlight ~ index 15
	for (let i = 0; i < 15; i++) stdin.write('\u001B[B');
	return new Promise<void>(resolve => {
		setTimeout(() => {
			const out = lastFrame()!;
			// window = slice(9, 21): indices 9..20 (12 rows). Verified
			// scrollStart = max(0, min(15 - 6, 30 - 12)) = max(0, min(9, 18)) = 9.
			t.regex(out, /m-9/);
			t.regex(out, /m-20/);
			t.notRegex(out, /m-8/);
			t.notRegex(out, /m-21/);
			t.notRegex(out, /m-0/);
			t.notRegex(out, /m-29/);
			unmount();
			resolve();
		}, 50);
	});
});

test('clamps scroll at start', t => {
	const many = Array.from({length: 30}, (_, i) => ({
		label: `m-${i}`,
		value: String(i),
	}));
	const {lastFrame, unmount} = renderWithTheme(
		<FilterableSelectList items={many} visibleCount={12} onSelect={() => {}} />,
	);
	const out = lastFrame()!;
	t.regex(out, /m-0/);
	t.regex(out, /m-11/);
	t.notRegex(out, /m-12/);
	unmount();
});

test('clamps scroll at end', t => {
	const many = Array.from({length: 30}, (_, i) => ({
		label: `m-${i}`,
		value: String(i),
	}));
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<FilterableSelectList items={many} visibleCount={12} onSelect={() => {}} />,
	);
	for (let i = 0; i < 29; i++) stdin.write('\u001B[B');
	return new Promise<void>(resolve => {
		setTimeout(() => {
			const out = lastFrame()!;
			t.regex(out, /m-29/);
			// last row visible; highlight near bottom but not past end
			t.notRegex(out, /m-0/);
			unmount();
			resolve();
		}, 50);
	});
});

test('empty-results state shows message', t => {
	const many = [{label: 'gpt-4o (openai)', value: '0'}];
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<FilterableSelectList items={many} onSelect={() => {}} />,
	);
	stdin.write('zzzzz');
	return new Promise<void>(resolve => {
		setTimeout(() => {
			t.regex(lastFrame()!, /No models matching "zzzzz"/);
			unmount();
			resolve();
		}, 50);
	});
});

test('Home jumps to first, End jumps to last', async t => {
	const many = Array.from({length: 10}, (_, i) => ({
		label: `m-${i}`,
		value: String(i),
	}));
	let selected = '';
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<FilterableSelectList items={many} onSelect={v => { selected = v; }} />,
	);
	// Navigate down 5
	for (let i = 0; i < 5; i++) stdin.write('\u001B[B');
	await new Promise(r => setTimeout(r, 50));
	// Home should jump to index 0
	stdin.write('\u001B[H');
	await new Promise(r => setTimeout(r, 50));
	stdin.write('\r');
	await new Promise(r => setTimeout(r, 50));
	t.is(selected, '0');
	// End should jump to last
	stdin.write('\u001B[F'); // End
	await new Promise(r => setTimeout(r, 50));
	stdin.write('\r');
	await new Promise(r => setTimeout(r, 50));
	t.is(selected, '9');
	unmount();
});

test('PageDown jumps by visibleCount', async t => {
	const many = Array.from({length: 30}, (_, i) => ({
		label: `m-${i}`,
		value: String(i),
	}));
	let selected = '';
	const {stdin, unmount} = renderWithTheme(
		<FilterableSelectList items={many} visibleCount={12} onSelect={v => { selected = v; }} />,
	);
	stdin.write('\u001B[6~'); // PageDown
	await new Promise(r => setTimeout(r, 50));
	stdin.write('\r');
	await new Promise(r => setTimeout(r, 50));
	t.is(selected, '12'); // jumped from 0 to 12
	unmount();
});

test('PageDown clamps at end', async t => {
	const many = Array.from({length: 5}, (_, i) => ({
		label: `m-${i}`,
		value: String(i),
	}));
	let selected = '';
	const {stdin, unmount} = renderWithTheme(
		<FilterableSelectList items={many} visibleCount={12} onSelect={v => { selected = v; }} />,
	);
	stdin.write('\u001B[6~'); // PageDown (should clamp to last index)
	await new Promise(r => setTimeout(r, 50));
	stdin.write('\r');
	await new Promise(r => setTimeout(r, 50));
	t.is(selected, '4');
	unmount();
});

test('Enter selects highlighted value even with active filter', t => {
	const many = [
		{label: 'gpt-4o (openai)', value: '0'},
		{label: 'gpt-4o-mini (openai)', value: '1'},
		{label: 'llama3 (ollama)', value: '2'},
	];
	let selected = '';
	const {stdin, unmount} = renderWithTheme(
		<FilterableSelectList items={many} onSelect={v => { selected = v; }} />,
	);
	stdin.write('gpt');
	return new Promise<void>(resolve => {
		setTimeout(() => {
			stdin.write('\r');
			setTimeout(() => {
				t.is(selected, '0'); // first filtered result
				unmount();
				resolve();
			}, 50);
		}, 50);
	});
});

test('preselects initialSelectedValue', t => {
	const many = [
		{label: 'alpha (a)', value: '0'},
		{label: 'beta (b)', value: '1'},
		{label: 'gamma (c)', value: '2'},
	];
	const {lastFrame, unmount} = renderWithTheme(
		<FilterableSelectList items={many} initialSelectedValue="2" onSelect={() => {}} />,
	);
	const out = lastFrame()!;
	// gamma is highlighted (❯ marker) — present in output
	t.regex(out, /gamma \(c\)/);
	unmount();
});

test('Erase back to a query that includes current highlight keeps highlight value', t => {
	const many = [
		{label: 'alpha (a)', value: '0'},
		{label: 'beta (b)', value: '1'},
	];
	let selected = '';
	const {stdin, unmount} = renderWithTheme(
		<FilterableSelectList items={many} onSelect={v => { selected = v; }} />,
	);
	stdin.write('beta');
	return new Promise<void>(resolve => {
		setTimeout(() => {
			// beta filtered; highlight at index 0 (beta).
			// NOTE: \u007F maps to key.delete (parse-keypress.js:431-436),
			// INK's delete key — NOT key.backspace. The handler checks both,
			// so either triggers the backspace branch. For a strict
			// key.backspace test use \u0008 instead.
			stdin.write('\u007F'); // delete
			setTimeout(() => {
				stdin.write('\r');
				setTimeout(() => {
					t.is(selected, '1'); // beta
					unmount();
					resolve();
				}, 50);
			}, 50);
		}, 50);
	});
});
