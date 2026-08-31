import test from 'ava';
import type {Message} from '@/types/core';
import {generateExportFilename, uniqueFilename} from './generate-export-filename';
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

test('uniqueFilename returns original when file does not exist', async t => {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'export-test-'));
	const filepath = path.join(tmpDir, 'test.md');
	const result = await uniqueFilename(filepath);
	t.is(result, filepath);
	await fs.rm(tmpDir, {recursive: true});
});

test('uniqueFilename appends counter when file exists', async t => {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'export-test-'));
	const filepath = path.join(tmpDir, 'test.md');
	await fs.writeFile(filepath, 'existing');
	const result = await uniqueFilename(filepath);
	t.is(result, path.join(tmpDir, 'test-2.md'));
	await fs.rm(tmpDir, {recursive: true});
});

test('uniqueFilename increments counter for multiple collisions', async t => {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'export-test-'));
	const filepath = path.join(tmpDir, 'test.md');
	await fs.writeFile(filepath, 'existing');
	await fs.writeFile(path.join(tmpDir, 'test-2.md'), 'existing');
	await fs.writeFile(path.join(tmpDir, 'test-3.md'), 'existing');
	const result = await uniqueFilename(filepath);
	t.is(result, path.join(tmpDir, 'test-4.md'));
	await fs.rm(tmpDir, {recursive: true});
});

test('uniqueFilename never returns the original path after exhausting counters', async t => {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'export-test-'));
	const filepath = path.join(tmpDir, 'test.md');
	await fs.writeFile(filepath, 'existing');
	await fs.writeFile(path.join(tmpDir, 'test-2.md'), 'existing');
	await fs.writeFile(path.join(tmpDir, 'test-3.md'), 'existing');
	await fs.writeFile(path.join(tmpDir, 'test-4.md'), 'existing');
	await fs.writeFile(path.join(tmpDir, 'test-5.md'), 'existing');
	await fs.writeFile(path.join(tmpDir, 'test-6.md'), 'existing');

	const result = await uniqueFilename(filepath);

	t.not(result, filepath);
	t.not(result, path.join(tmpDir, 'test-2.md'));
	t.not(result, path.join(tmpDir, 'test-3.md'));
	t.not(result, path.join(tmpDir, 'test-4.md'));
	t.not(result, path.join(tmpDir, 'test-5.md'));
	t.not(result, path.join(tmpDir, 'test-6.md'));
	t.true(result.startsWith(path.join(tmpDir, 'test-new-')));
	t.true(result.endsWith('.md'));
	await fs.rm(tmpDir, {recursive: true});
});
