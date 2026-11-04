import test from 'ava';
import {appendTurnContext, stripTurnContext} from './turn-context.js';

console.log('\nturn-context.spec.ts');

const SKILLS = '## Available Skills\n\nUse the thing.';
const MEMORIES = '## Project Context\n\n```\n- Auth uses Clerk.\n```';

// --- appendTurnContext ---
//
// The whole point of #1574 is that the bytes a backend has already processed
// never change, so these assert exact strings rather than `includes`.

test('a turn with no context is byte-identical to the plain message', t => {
	t.is(appendTurnContext('fix the auth bug', []), 'fix the auth bug');
	t.is(appendTurnContext('fix the auth bug', ['']), 'fix the auth bug');
	t.is(
		appendTurnContext('fix the auth bug', [undefined, null, '   ']),
		'fix the auth bug',
	);
});

test('one section is wrapped and appended after the message', t => {
	t.is(
		appendTurnContext('fix the auth bug', [MEMORIES]),
		`fix the auth bug\n\n<turn-context>\n${MEMORIES}\n</turn-context>`,
	);
});

test('several sections are joined inside a single block', t => {
	t.is(
		appendTurnContext('fix it', [SKILLS, MEMORIES]),
		`fix it\n\n<turn-context>\n${SKILLS}\n\n${MEMORIES}\n</turn-context>`,
	);
});

test('empty sections are skipped without leaving blank gaps', t => {
	t.is(
		appendTurnContext('fix it', ['', MEMORIES, undefined]),
		`fix it\n\n<turn-context>\n${MEMORIES}\n</turn-context>`,
	);
});

test('an image-only turn gets no leading blank line', t => {
	t.is(
		appendTurnContext('', [MEMORIES]),
		`<turn-context>\n${MEMORIES}\n</turn-context>`,
	);
});

// Appending rather than prepending is load-bearing: every history predicate in
// the codebase matches on content.startsWith(), and session titles derive from
// the opening of the first user message.
test('the user text stays at the start of the message', t => {
	const result = appendTurnContext('Automatic diagnostics found issues.', [
		MEMORIES,
	]);
	t.true(result.startsWith('Automatic diagnostics found issues.'));
});

// --- stripTurnContext ---

test('stripping returns the original message', t => {
	const sent = appendTurnContext('fix the auth bug', [SKILLS, MEMORIES]);
	t.is(stripTurnContext(sent), 'fix the auth bug');
});

test('a message without a block is returned unchanged', t => {
	t.is(stripTurnContext('just a message'), 'just a message');
	t.is(stripTurnContext(''), '');
});

test('a block whose body contains angle brackets is still removed whole', t => {
	const sent = appendTurnContext('fix it', [
		'## Project Context\n\n```\n- Prefer <Foo> over </Bar>.\n```',
	]);
	t.is(stripTurnContext(sent), 'fix it');
});

test('several blocks are each removed', t => {
	const once = appendTurnContext('fix it', [MEMORIES]);
	const twice = appendTurnContext(once, [SKILLS]);
	t.is(stripTurnContext(twice), 'fix it');
});

test('an image-only turn strips back to empty', t => {
	t.is(stripTurnContext(appendTurnContext('', [MEMORIES])), '');
});
