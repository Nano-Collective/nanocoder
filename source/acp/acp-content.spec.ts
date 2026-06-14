import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'ava';
import {
	acpContentToUserMessage,
	acpContentToUserText,
} from '@/acp/acp-content';

console.log('\nacp-content.spec.ts');

// ============================================================================
// acpContentToUserText
// ============================================================================

test('acpContentToUserText - empty array returns empty string', async t => {
	t.is(await acpContentToUserText([]), '');
});

test('acpContentToUserText - single text block returns its text', async t => {
	const result = await acpContentToUserText([{type: 'text', text: 'Hello'}]);
	t.is(result, 'Hello');
});

test('acpContentToUserText - multiple text blocks concatenated in order', async t => {
	const result = await acpContentToUserText([
		{type: 'text', text: 'Hello '},
		{type: 'text', text: 'World'},
	]);
	t.is(result, 'Hello World');
});

test('acpContentToUserText - preserves exact text content', async t => {
	const specialText = 'Hello "world"\nNew line\tTab';
	const result = await acpContentToUserText([{type: 'text', text: specialText}]);
	t.is(result, specialText);
});

test('acpContentToUserMessage - extracts supported image blocks as attachments', async t => {
	const result = await acpContentToUserMessage([
		{type: 'text', text: 'look at this'},
		{type: 'image', data: 'abc', mimeType: 'image/png'} as any,
	]);
	t.is(result.text, 'look at this');
	t.deepEqual(result.images, [
		{data: 'abc', mediaType: 'image/png', source: 'acp'},
	]);
});

test('acpContentToUserMessage - notes unsupported image media types instead of sending', async t => {
	const result = await acpContentToUserMessage([
		{type: 'image', data: 'abc', mimeType: 'image/tiff'} as any,
	]);
	t.is(result.images.length, 0);
	t.true(result.text.toLowerCase().includes('omitted'));
});

test('acpContentToUserText - still notes audio attachments instead of dropping', async t => {
	const result = await acpContentToUserText([
		{type: 'audio', data: 'abc', mimeType: 'audio/wav'} as any,
	]);
	t.true(result.includes('audio'));
	t.true(result.toLowerCase().includes('omitted'));
});

test('acpContentToUserText - inlines embedded text resources', async t => {
	const result = await acpContentToUserText([
		{type: 'text', text: 'Look at this: '},
		{
			type: 'resource',
			resource: {uri: 'file:///tmp/foo.ts', text: 'const x = 1;'},
		} as any,
	]);
	t.true(result.startsWith('Look at this: '));
	t.true(result.includes('const x = 1;'));
	t.true(result.includes('file:///tmp/foo.ts'));
});

test('acpContentToUserText - notes embedded binary resources', async t => {
	const result = await acpContentToUserText([
		{
			type: 'resource',
			resource: {uri: 'file:///tmp/foo.bin', blob: 'AAAA', mimeType: 'application/octet-stream'},
		} as any,
	]);
	t.true(result.toLowerCase().includes('binary'));
	t.true(result.includes('file:///tmp/foo.bin'));
});

test('acpContentToUserText - reads resource_link files from disk', async t => {
	const dir = mkdtempSync(join(tmpdir(), 'acp-content-'));
	const filePath = join(dir, 'tagged.txt');
	writeFileSync(filePath, 'tagged file body');
	try {
		const result = await acpContentToUserText([
			{type: 'text', text: 'Review '},
			{
				type: 'resource_link',
				name: 'tagged.txt',
				uri: pathToFileURL(filePath).href,
			} as any,
		]);
		t.true(result.includes('tagged file body'));
		t.true(result.includes(filePath));
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('acpContentToUserText - prefers client readTextFile when capability present', async t => {
	let calledWith: {sessionId: string; path: string} | undefined;
	const ctx = {
		sessionId: 'sess-1',
		canReadTextFile: true,
		conn: {
			readTextFile: async (params: {sessionId: string; path: string}) => {
				calledWith = params;
				return {content: 'live editor buffer'};
			},
		} as any,
	};
	const result = await acpContentToUserText(
		[
			{
				type: 'resource_link',
				name: 'open.ts',
				uri: 'file:///abs/open.ts',
			} as any,
		],
		ctx,
	);
	t.is(calledWith?.path, '/abs/open.ts');
	t.is(calledWith?.sessionId, 'sess-1');
	t.true(result.includes('live editor buffer'));
});

test('acpContentToUserText - reports unreadable resource_link files', async t => {
	const result = await acpContentToUserText([
		{
			type: 'resource_link',
			name: 'missing.txt',
			uri: 'file:///definitely/not/here/missing.txt',
		} as any,
	]);
	t.true(result.toLowerCase().includes('could not read'));
});

test('acpContentToUserText - surfaces non-file resource links', async t => {
	const result = await acpContentToUserText([
		{
			type: 'resource_link',
			name: 'Docs',
			uri: 'https://example.com/docs',
		} as any,
	]);
	t.true(result.includes('https://example.com/docs'));
});
