import test from 'ava';
import type {Message} from '@/types/core';
import {generateExportFilename, writeUniqueFile} from './generate-export-filename';
import {promises as fs} from 'fs';
import path from 'path';
import os from 'os';

const user = (content: string): Message => ({role: 'user', content});
const assistant = (content: string): Message => ({role: 'assistant', content});

test('generates slug from first user message', t => {
	const messages = [user('fix the login bug')];
	const filename = generateExportFilename(messages);
	t.regex(filename, /^fix-the-login-bug-\d{4}-\d{2}-\d{2}\.md$/);
});

test('truncates to 4 words', t => {
	const messages = [user('add dark mode toggle to the navbar')];
	const filename = generateExportFilename(messages);
	t.regex(filename, /^add-dark-mode-toggle-\d{4}-\d{2}-\d{2}\.md$/);
});

test('handles single word message', t => {
	const messages = [user('hello')];
	const filename = generateExportFilename(messages);
	t.regex(filename, /^hello-\d{4}-\d{2}-\d{2}\.md$/);
});

test('strips special characters', t => {
	const messages = [user('fix: the auth login')];
	const filename = generateExportFilename(messages);
	t.regex(filename, /^fix-the-auth-login-\d{4}-\d{2}-\d{2}\.md$/);
});

test('trims leading and trailing whitespace', t => {
	const messages = [user('  setup react router  ')];
	const filename = generateExportFilename(messages);
	t.regex(filename, /^setup-react-router-\d{4}-\d{2}-\d{2}\.md$/);
});

test('handles newlines in first line', t => {
	const messages = [user('fix the bug\nin the auth module')];
	const filename = generateExportFilename(messages);
	t.regex(filename, /^fix-the-bug-\d{4}-\d{2}-\d{2}\.md$/);
});

test('falls back when no user messages', t => {
	const messages = [assistant('hello')];
	const filename = generateExportFilename(messages);
	t.regex(filename, /^nanocoder-chat-\d{4}-\d{2}-\d{2}\.md$/);
});

test('falls back on empty messages array', t => {
	const filename = generateExportFilename([]);
	t.regex(filename, /^nanocoder-chat-\d{4}-\d{2}-\d{2}\.md$/);
});

test('falls back on empty content', t => {
	const messages = [user('')];
	const filename = generateExportFilename(messages);
	t.regex(filename, /^nanocoder-chat-\d{4}-\d{2}-\d{2}\.md$/);
});

test('skips empty first line and uses second', t => {
	const messages = [user('\nfix the login bug')];
	const filename = generateExportFilename(messages);
	t.regex(filename, /^fix-the-login-bug-\d{4}-\d{2}-\d{2}\.md$/);
});

test('truncates long slug at word boundary', t => {
	const messages = [user('a'.repeat(100))];
	const filename = generateExportFilename(messages);
	const slug = filename.replace(/-\d{4}-\d{2}-\d{2}\.md$/, '');
	t.true(slug.length <= 40);
	t.false(slug.endsWith('-'));
});

test('preserves CJK characters in slug', t => {
	const messages = [user('修复登录问题')];
	const filename = generateExportFilename(messages);
	t.regex(filename, /^修复登录问题-\d{4}-\d{2}-\d{2}\.md$/);
});

test('preserves Cyrillic characters in slug', t => {
	const messages = [user('исправить ошибку входа')];
	const filename = generateExportFilename(messages);
	t.regex(filename, /^исправить-ошибку-входа-\d{4}-\d{2}-\d{2}\.md$/);
});

test('strips emoji while keeping adjacent words', t => {
	const messages = [user('fix the 🐛 bug')];
	const filename = generateExportFilename(messages);
	t.regex(filename, /^fix-the-bug-\d{4}-\d{2}-\d{2}\.md$/);
});

test('writeUniqueFile writes to the given path when it is free', async t => {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'export-test-'));
	const filepath = path.join(tmpDir, 'test.md');
	const result = await writeUniqueFile(filepath, 'content');
	t.is(result, filepath);
	t.is(await fs.readFile(filepath, 'utf-8'), 'content');
	await fs.rm(tmpDir, {recursive: true});
});

test('writeUniqueFile appends a counter when the path is taken', async t => {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'export-test-'));
	const filepath = path.join(tmpDir, 'test.md');
	await fs.writeFile(filepath, 'existing');
	const result = await writeUniqueFile(filepath, 'content');
	t.is(result, path.join(tmpDir, 'test-2.md'));
	t.is(await fs.readFile(path.join(tmpDir, 'test-2.md'), 'utf-8'), 'content');
	await fs.rm(tmpDir, {recursive: true});
});

test('writeUniqueFile never overwrites an existing file', async t => {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'export-test-'));
	const filepath = path.join(tmpDir, 'test.md');
	const originals = [
		'test.md',
		'test-2.md',
		'test-3.md',
		'test-4.md',
		'test-5.md',
		'test-6.md',
	];
	for (const name of originals) {
		await fs.writeFile(path.join(tmpDir, name), 'existing');
	}

	const result = await writeUniqueFile(filepath, 'content');

	// Every pre-existing file keeps its content — none may be clobbered.
	for (const name of originals) {
		t.is(await fs.readFile(path.join(tmpDir, name), 'utf-8'), 'existing');
	}
	// The writer must have landed in a fresh, distinct file (timestamp suffix).
	t.not(result, filepath);
	t.true(result.startsWith(path.join(tmpDir, 'test-new-')));
	t.true(result.endsWith('.md'));
	t.is(await fs.readFile(result, 'utf-8'), 'content');
	await fs.rm(tmpDir, {recursive: true});
});

test('writeUniqueFile is atomic: the original is never clobbered by a race', async t => {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'export-test-'));
	const filepath = path.join(tmpDir, 'test.md');
	await fs.writeFile(filepath, 'original');

	// Simulate TWO concurrent exclusive-flag writers for the same target. Only
	// one may win the base name; the other must fall to a suffix, and the
	// original file's contents must be preserved.
	const [a, b] = await Promise.all([
		writeUniqueFile(filepath, 'first'),
		writeUniqueFile(filepath, 'second'),
	]);

	t.not(a, filepath);
	t.not(b, filepath);
	t.not(a, b);
	t.is(await fs.readFile(filepath, 'utf-8'), 'original');
	await fs.rm(tmpDir, {recursive: true});
});
