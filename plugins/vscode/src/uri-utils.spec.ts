import test from 'ava';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/**
 * `media/uri-utils.js` ships as a plain browser script, so it is loaded
 * into a VM context here rather than imported. The IIFE assigns onto
 * `globalThis`, which inside a VM context is the sandbox.
 */
const source = readFileSync(
	fileURLToPath(new URL('../media/uri-utils.js', import.meta.url)),
	'utf8',
);

const sandbox: Record<string, any> = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const { fileUriToPath, parseDropPayload } = sandbox.NanocoderUriUtils;

// ── fileUriToPath: posix ──────────────────────────────────

// The regression this file exists for: /^file:\/\/\/?/ ate the root slash and
// handed the extension host "Users/me/x.ts", which statSync could never
// resolve, so every drop was a silent no-op.
test('fileUriToPath - posix path keeps its leading slash', t => {
	t.is(fileUriToPath('file:///Users/me/x.ts', false), '/Users/me/x.ts');
});

test('fileUriToPath - posix path at root', t => {
	t.is(fileUriToPath('file:///x.ts', false), '/x.ts');
});

test('fileUriToPath - percent-escapes are decoded', t => {
	t.is(fileUriToPath('file:///Users/me/my%20file.ts', false), '/Users/me/my file.ts');
	t.is(fileUriToPath('file:///Users/me/a%23b.ts', false), '/Users/me/a#b.ts');
});

test('fileUriToPath - malformed escape falls back to the raw path', t => {
	t.is(fileUriToPath('file:///Users/me/100%.ts', false), '/Users/me/100%.ts');
});

test('fileUriToPath - directory URI keeps its trailing slash', t => {
	t.is(fileUriToPath('file:///Users/me/src/', false), '/Users/me/src/');
});

// ── fileUriToPath: windows ────────────────────────────────

test('fileUriToPath - windows drive letter drops the leading slash', t => {
	t.is(fileUriToPath('file:///C:/dev/x.ts', true), 'C:\\dev\\x.ts');
});

test('fileUriToPath - windows drive letter percent-encoded colon', t => {
	t.is(fileUriToPath('file:///c%3A/dev/x.ts', true), 'c:\\dev\\x.ts');
});

test('fileUriToPath - windows UNC share', t => {
	t.is(fileUriToPath('file://server/share/x.ts', true), '\\\\server\\share\\x.ts');
});

test('fileUriToPath - authority is not mistaken for a path segment on posix', t => {
	t.is(fileUriToPath('file://server/share/x.ts', false), '//server/share/x.ts');
});

// ── fileUriToPath: rejections and bare paths ──────────────

test('fileUriToPath - bare absolute posix path passes through', t => {
	t.is(fileUriToPath('/Users/me/x.ts', false), '/Users/me/x.ts');
});

test('fileUriToPath - bare absolute windows path passes through', t => {
	t.is(fileUriToPath('C:\\dev\\x.ts', true), 'C:\\dev\\x.ts');
	t.is(fileUriToPath('\\\\server\\share', true), '\\\\server\\share');
});

test('fileUriToPath - relative paths are rejected', t => {
	t.is(fileUriToPath('src/x.ts', false), null);
});

test('fileUriToPath - non-file URLs are rejected', t => {
	t.is(fileUriToPath('https://example.com/x.ts', false), null);
	t.is(fileUriToPath('untitled:Untitled-1', false), null);
});

test('fileUriToPath - dragged text is rejected', t => {
	t.is(fileUriToPath('some selected words', false), null);
});

test('fileUriToPath - empty and non-string input', t => {
	t.is(fileUriToPath('', false), null);
	t.is(fileUriToPath('   ', false), null);
	t.is(fileUriToPath(undefined, false), null);
	t.is(fileUriToPath(null, false), null);
	t.is(fileUriToPath('file://', false), null);
});

// ── parseDropPayload ──────────────────────────────────────

test('parseDropPayload - multiple URIs, one per line', t => {
	t.deepEqual(
		parseDropPayload('file:///a/b.ts\nfile:///a/c.ts', false),
		['/a/b.ts', '/a/c.ts'],
	);
});

test('parseDropPayload - CRLF line endings', t => {
	t.deepEqual(
		parseDropPayload('file:///a/b.ts\r\nfile:///a/c.ts\r\n', false),
		['/a/b.ts', '/a/c.ts'],
	);
});

test('parseDropPayload - comment lines are skipped', t => {
	t.deepEqual(
		parseDropPayload('# a comment\nfile:///a/b.ts', false),
		['/a/b.ts'],
	);
});

test('parseDropPayload - unusable entries are dropped, not passed through', t => {
	t.deepEqual(
		parseDropPayload('https://example.com\nfile:///a/b.ts\nnonsense', false),
		['/a/b.ts'],
	);
});

test('parseDropPayload - duplicates are collapsed', t => {
	t.deepEqual(
		parseDropPayload('file:///a/b.ts\nfile:///a/b.ts', false),
		['/a/b.ts'],
	);
});

test('parseDropPayload - empty payload', t => {
	t.deepEqual(parseDropPayload('', false), []);
	t.deepEqual(parseDropPayload(undefined, false), []);
});
