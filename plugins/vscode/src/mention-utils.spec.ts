import test from 'ava';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/**
 * `media/mention-utils.js` ships as a plain browser script, so it is loaded
 * into a VM context here rather than imported. The IIFE assigns onto
 * `globalThis`, which inside a VM context is the sandbox.
 */
const source = readFileSync(
	fileURLToPath(new URL('../media/mention-utils.js', import.meta.url)),
	'utf8',
);

const sandbox: Record<string, any> = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const { findMentionQuery, removeMentionToken, mentionTokenEnd, MAX_MENTION_TOKEN } =
	sandbox.NanocoderMentionUtils;

// ── findMentionQuery: positive cases ──────────────────────

test('findMentionQuery - bare @ at start of input', t => {
	t.deepEqual(findMentionQuery('@', 1), { start: 0, query: '' });
});

test('findMentionQuery - @ after whitespace', t => {
	t.deepEqual(findMentionQuery('hello @src', 10), { start: 6, query: 'src' });
});

test('findMentionQuery - @ after a newline', t => {
	t.deepEqual(findMentionQuery('line one\n@app', 13), { start: 9, query: 'app' });
});

test('findMentionQuery - second mention on the same line', t => {
	t.deepEqual(findMentionQuery('@a @b', 5), { start: 3, query: 'b' });
});

test('findMentionQuery - query keeps path separators', t => {
	t.deepEqual(findMentionQuery('@src/mention', 12), {
		start: 0,
		query: 'src/mention',
	});
});

test('findMentionQuery - caret mid-token truncates the query', t => {
	// Caret sits after "so" in "@source"; the completion should search "so",
	// not the whole word the user has already typed past.
	t.deepEqual(findMentionQuery('@source', 3), { start: 0, query: 'so' });
});

// ── findMentionQuery: the rules that keep prose quiet ─────

test('findMentionQuery - email address does not trigger', t => {
	t.is(findMentionQuery('user@example.com', 16), null);
});

test('findMentionQuery - @ glued to a preceding word does not trigger', t => {
	t.is(findMentionQuery('npm i pkg@1.2.3', 15), null);
});

test('findMentionQuery - whitespace after the token ends the mention', t => {
	t.is(findMentionQuery('hello @src foo', 14), null);
});

test('findMentionQuery - a completed mention followed by a space is closed', t => {
	t.is(findMentionQuery('@src ', 5), null);
});

test('findMentionQuery - caret before the @ does not trigger', t => {
	t.is(findMentionQuery('hello @src', 5), null);
});

test('findMentionQuery - plain text with no @ returns null', t => {
	t.is(findMentionQuery('just some words', 15), null);
});

test('findMentionQuery - token longer than the cap is abandoned', t => {
	const long = '@' + 'a'.repeat(MAX_MENTION_TOKEN + 10);
	t.is(findMentionQuery(long, long.length), null);
});

// ── findMentionQuery: guards ──────────────────────────────

test('findMentionQuery - rejects non-string and out-of-range input', t => {
	t.is(findMentionQuery(null as any, 0), null);
	t.is(findMentionQuery('@abc', -1), null);
	t.is(findMentionQuery('@abc', 99), null);
	t.is(findMentionQuery('', 0), null);
});

// ── removeMentionToken ──────────────────────────

test('removeMentionToken - strips the token and returns the caret', t => {
	t.deepEqual(removeMentionToken('look at @src', 8), {
		text: 'look at ',
		cursor: 8,
	});
});

test('removeMentionToken - preserves text after the token', t => {
	t.deepEqual(removeMentionToken('a @tok b', 2), { text: 'a  b', cursor: 2 });
});

/**
 * Regression: accepting a completion with the caret mid-token used to slice
 * only up to the caret, stranding the tail next to the chip that replaced it.
 */
test('removeMentionToken - takes the whole token, not just up to the caret', t => {
	t.deepEqual(removeMentionToken('@src/foo', 0), { text: '', cursor: 0 });
});

test('removeMentionToken - mid-token accept leaves no suffix behind', t => {
	t.deepEqual(removeMentionToken('see @src/foo bar', 4), {
		text: 'see  bar',
		cursor: 4,
	});
});

test('removeMentionToken - stops at the whitespace ending the token', t => {
	t.deepEqual(removeMentionToken('@a @b', 0), { text: ' @b', cursor: 0 });
	t.deepEqual(removeMentionToken('@a @b', 3), { text: '@a ', cursor: 3 });
});

test('removeMentionToken - clamps out-of-range offsets', t => {
	t.deepEqual(removeMentionToken('abc', -5), { text: '', cursor: 0 });
	t.deepEqual(removeMentionToken('abc', 999), { text: 'abc', cursor: 3 });
});

test('removeMentionToken - handles non-string input', t => {
	t.deepEqual(removeMentionToken(undefined as any, 0), {
		text: '',
		cursor: 0,
	});
});

// ── mentionTokenEnd ────────────────────────────

test('mentionTokenEnd - runs to end of input when no whitespace follows', t => {
	t.is(mentionTokenEnd('@src/foo', 0), 8);
});

test('mentionTokenEnd - stops at the first whitespace', t => {
	t.is(mentionTokenEnd('@src foo', 0), 4);
});

test('mentionTokenEnd - is capped by MAX_MENTION_TOKEN', t => {
	const long = '@' + 'a'.repeat(MAX_MENTION_TOKEN * 2);
	t.is(mentionTokenEnd(long, 0), MAX_MENTION_TOKEN);
});
