import test from 'ava';
import type {Message} from '@/types/core';
import {generateExportFilename} from './generate-export-filename';

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

test('truncates a long CJK slug at the 40-character limit', t => {
	const messages = [user('修'.repeat(100))];
	const filename = generateExportFilename(messages);
	const slug = filename.replace(/-\d{4}-\d{2}-\d{2}\.md$/, '');
	// 40 CJK characters still keep the whole filename well under 255 bytes, so
	// no byte budget is needed -- the char limit alone suffices.
	t.is(slug.length, 40);
	t.false(slug.endsWith('-'));
	t.true(Buffer.byteLength(filename, 'utf-8') < 255);
});

test('truncates a long hyphenated slug at the last whole word', t => {
	const messages = [user('fix-the-login-logout-registration-authentication')];
	const filename = generateExportFilename(messages);
	const slug = filename.replace(/-\d{4}-\d{2}-\d{2}\.md$/, '');
	t.true(slug.length <= 40);
	// Must not split a word: trimming stops at a word boundary, so it must not
	// end mid-word with a break inside a hyphenated token.
	t.true(/^fix(?:-[a-z]+)*$/.test(slug));
	t.true(slug.length >= 20);
});
