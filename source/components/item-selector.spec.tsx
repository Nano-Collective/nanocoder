import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../test-utils/render-with-theme.js';
import {ItemSelector} from './item-selector.js';

console.log('\nitem-selector.spec.tsx');

const items = [
	{label: 'alpha (a)', value: '0'},
	{label: 'beta (b)', value: '1'},
];

test('ItemSelector renders FilterableSelectList when searchable', t => {
	const {lastFrame} = renderWithTheme(
		<ItemSelector
			title="Select"
			items={items}
			searchable
			onSelect={() => {}}
			onCancel={() => {}}
		/>,
	);
	const out = lastFrame()!;
	// search affordance row is rendered by FilterableSelectList
	t.regex(out, /Type to filter/);
	t.regex(out, /alpha \(a\)/);
});

test('ItemSelector shows the search hint when searchable', t => {
	const {lastFrame} = renderWithTheme(
		<ItemSelector
			title="Select"
			items={items}
			searchable
			onSelect={() => {}}
			onCancel={() => {}}
		/>,
	);
	t.regex(lastFrame()!, /Type to filter · .* · Enter select · Esc cancel/);
});

test('ItemSelector keeps SelectInput behavior when not searchable', t => {
	const {lastFrame} = renderWithTheme(
		<ItemSelector
			title="Select"
			items={items}
			onSelect={() => {}}
			onCancel={() => {}}
		/>,
	);
	const out = lastFrame()!;
	t.regex(out, /alpha \(a\)/);
	t.regex(out, /Press Escape to cancel/);
});

test('ItemSelector fires onCancel on Escape during error branch', async t => {
	let cancelled = false;
	const {stdin} = renderWithTheme(
		<ItemSelector
			title="Select"
			items={items}
			searchable
			error="boom"
			onSelect={() => {}}
			onCancel={() => {
				cancelled = true;
			}}
		/>,
	);
	stdin.write('\u001B'); // escape
	await new Promise(resolve => setTimeout(resolve, 50));
	t.true(cancelled);
});

test('ItemSelector does not double-fire onCancel in searchable normal path', async t => {
	let calls = 0;
	const {stdin, unmount} = renderWithTheme(
		<ItemSelector
			title="Select"
			items={items}
			searchable
			onSelect={() => {}}
			onCancel={() => {
				calls++;
			}}
		/>,
	);
	stdin.write('\u001B'); // escape
	await new Promise(resolve => setTimeout(resolve, 50));
	t.is(calls, 1);
	unmount();
});

test('ItemSelector fires onCancel on Escape during loading branch', async t => {
	let cancelled = false;
	const {stdin} = renderWithTheme(
		<ItemSelector
			title="Select"
			items={items}
			searchable
			loading
			onSelect={() => {}}
			onCancel={() => {
				cancelled = true;
			}}
		/>,
	);
	stdin.write('\u001B'); // escape
	await new Promise(resolve => setTimeout(resolve, 50));
	t.true(cancelled);
});
