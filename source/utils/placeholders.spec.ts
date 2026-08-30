import test from 'ava';
import type {PlaceholderContent} from '../types/hooks';
import {PlaceholderType} from '../types/hooks';
import {allocatePlaceholderId, findPlaceholderOccurrences} from './placeholders';

console.log('\nplaceholders.spec.ts');

const paste = (displayText: string): PlaceholderContent => ({
	type: PlaceholderType.PASTE,
	displayText,
	content: 'body',
	originalSize: 4,
});

const file = (displayText: string): PlaceholderContent => ({
	type: PlaceholderType.FILE,
	displayText,
	filePath: '/repo/a.ts',
	content: 'body',
});

test('allocatePlaceholderId namespaces each type', t => {
	t.is(allocatePlaceholderId({}, PlaceholderType.PASTE).id, 'paste_1');
	t.is(allocatePlaceholderId({}, PlaceholderType.FILE).id, 'file_1');
});

test('allocatePlaceholderId counts only its own type', t => {
	const existing = {
		file_1: file('[@a.ts]'),
		file_2: file('[@b.ts]'),
	};

	t.is(allocatePlaceholderId(existing, PlaceholderType.PASTE).id, 'paste_1');
	t.is(allocatePlaceholderId(existing, PlaceholderType.FILE).id, 'file_3');
});

test('allocatePlaceholderId does not reuse an id after a deletion', t => {
	// paste_1 was deleted; paste_2 is still in the input.
	const existing = {paste_2: paste('[Paste #2: 4 chars]')};

	const next = allocatePlaceholderId(existing, PlaceholderType.PASTE);

	t.is(next.id, 'paste_3');
	t.is(next.ordinal, 3);
});

test('allocatePlaceholderId respects legacy bare-numeric paste keys', t => {
	const existing = {'7': paste('[Paste #7: 4 chars]')};

	t.is(allocatePlaceholderId(existing, PlaceholderType.PASTE).id, 'paste_8');
	// A bare number is never a file key, so files start fresh.
	t.is(allocatePlaceholderId(existing, PlaceholderType.FILE).id, 'file_1');
});

test('findPlaceholderOccurrences reports positions in document order', t => {
	const content = {
		paste_1: paste('[Paste #1: 4 chars]'),
		file_1: file('[@a.ts]'),
	};

	const occurrences = findPlaceholderOccurrences(
		'x [@a.ts] y [Paste #1: 4 chars]',
		content,
	);

	t.deepEqual(
		occurrences.map(o => o.id),
		['file_1', 'paste_1'],
	);
	t.is(occurrences[0].start, 2);
	t.is(occurrences[0].end, 9);
});

test('findPlaceholderOccurrences gives each duplicate its own entry', t => {
	const content = {file_1: file('[@a.ts]'), file_2: file('[@a.ts]')};

	const occurrences = findPlaceholderOccurrences('[@a.ts] [@a.ts]', content);

	t.is(occurrences.length, 2);
	t.deepEqual(
		occurrences.map(o => o.id),
		['file_1', 'file_2'],
	);
});

test('findPlaceholderOccurrences prefers the longest matching display text', t => {
	const content = {
		file_1: file('[@a.ts]'),
		file_2: file('[@a.ts] extended'),
	};

	const occurrences = findPlaceholderOccurrences('[@a.ts] extended', content);

	t.is(occurrences.length, 1);
	t.is(occurrences[0].id, 'file_2');
});

test('findPlaceholderOccurrences skips entries that are no longer in the text', t => {
	const content = {file_1: file('[@a.ts]'), file_2: file('[@gone.ts]')};

	const occurrences = findPlaceholderOccurrences('only [@a.ts]', content);

	t.deepEqual(
		occurrences.map(o => o.id),
		['file_1'],
	);
});
