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

// Mechanical compaction cuts a long user message at a character count, so a
// stored block can lose its closing tag. Without this, the remains would
// survive every strip and be shown to the user for the life of the session.
test('a block truncated past its opening tag is still removed', t => {
	const sent = appendTurnContext('fix the auth bug', [MEMORIES]);
	const truncated = sent.slice(0, sent.indexOf('\n', sent.indexOf('<turn-context>')) + 12);

	t.true(truncated.includes('<turn-context>'));
	t.false(truncated.includes('</turn-context>'));
	t.is(stripTurnContext(truncated), 'fix the auth bug');
});

test('a truncated block does not swallow a well-formed one before it', t => {
	const first = appendTurnContext('fix the auth bug', [MEMORIES]);
	const mangled = `${first}\n\n<turn-context>\n## Available Skills`;

	t.is(stripTurnContext(mangled), 'fix the auth bug');
});

test('an opening tag inside the user text is left alone', t => {
	// Only a block at the very end can be a truncation remnant; a tag the user
	// typed mid-message is their own text.
	const typed = 'why does <turn-context> show up in my export?';
	t.is(stripTurnContext(typed), typed);
});

test('a block the user pasted into their own text is left alone', t => {
	const typed = 'explain this wrapper:\n<turn-context>\nfoo\n</turn-context>\nthanks';
	t.is(stripTurnContext(typed), typed);
	t.is(
		stripTurnContext(appendTurnContext(typed, [MEMORIES])),
		typed,
	);
});

test('an unterminated tag the user typed on its own line is left alone', t => {
	const typed = 'look at this:\n<turn-context>\nunterminated sample\nmy real question';
	t.is(stripTurnContext(typed), typed);
});

test('a block at the end of a user message that quotes a block earlier is removed once', t => {
	const typed = 'compare:\n\n<turn-context>\nsample\n</turn-context>\n\nwith the real one';
	t.is(stripTurnContext(appendTurnContext(typed, [MEMORIES])), typed);
});
