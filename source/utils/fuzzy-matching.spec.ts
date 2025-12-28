import test from 'ava';
import {fuzzyScore, fuzzyScoreFilePath} from './fuzzy-matching';

console.log(`\nfuzzy-matching.spec.ts`);

// Tests for fuzzyScore (general text matching)
test('fuzzyScore - exact match returns highest score', t => {
	t.is(fuzzyScore('help', 'help'), 1000);
	t.is(fuzzyScore('status', 'status'), 1000);
});

test('fuzzyScore - case insensitive matching', t => {
	t.is(fuzzyScore('Help', 'help'), 1000);
	t.is(fuzzyScore('STATUS', 'status'), 1000);
	t.is(fuzzyScore('help', 'HELP'), 1000);
});

test('fuzzyScore - prefix match', t => {
	const score = fuzzyScore('help', 'hel');
	t.true(score > 0);
	t.true(score >= 800);
});

test('fuzzyScore - substring match', t => {
	const score = fuzzyScore('status', 'tat');
	t.true(score > 0);
	t.true(score >= 700);
});

test('fuzzyScore - sequential character match', t => {
	const score = fuzzyScore('provider', 'pvdr');
	t.true(score > 0);
	t.true(score < 700); // Should be lower than substring match
});

test('fuzzyScore - no match returns 0', t => {
	t.is(fuzzyScore('help', 'xyz'), 0);
	t.is(fuzzyScore('status', 'abc'), 0);
});

test('fuzzyScore - empty query returns 0', t => {
	t.is(fuzzyScore('help', ''), 0);
	t.is(fuzzyScore('anything', ''), 0);
});

test('fuzzyScore - ranks exact match higher than prefix', t => {
	const exactScore = fuzzyScore('help', 'help');
	const prefixScore = fuzzyScore('helper', 'help');
	t.true(exactScore > prefixScore);
});

test('fuzzyScore - ranks prefix higher than substring', t => {
	const prefixScore = fuzzyScore('helper', 'help');
	const substringScore = fuzzyScore('unhelpful', 'help');
	t.true(prefixScore > substringScore);
});

test('fuzzyScore - ranks substring higher than fuzzy', t => {
	const substringScore = fuzzyScore('helper', 'elp');
	const fuzzyScore1 = fuzzyScore('enable-lp', 'elp');
	t.true(substringScore > fuzzyScore1);
});

// Tests for fuzzyScoreFilePath (file path specific matching)
test('fuzzyScoreFilePath - exact filename match scores high', t => {
	const score = fuzzyScoreFilePath('src/utils/helper.ts', 'helper.ts');
	t.true(score >= 900);
});

test('fuzzyScoreFilePath - filename prefix scores higher than path prefix', t => {
	const filenameScore = fuzzyScoreFilePath('src/utils/helper.ts', 'help');
	const pathScore = fuzzyScoreFilePath('helper/src/utils/file.ts', 'help');
	t.true(filenameScore > pathScore);
});

test('fuzzyScoreFilePath - filename substring matches correctly', t => {
	const filenameScore = fuzzyScoreFilePath('src/utils/my-helper.ts', 'help');
	const pathScore = fuzzyScoreFilePath('helper/src/utils/file.ts', 'help');
	// Both should have scores, but path prefix might score higher than filename substring
	t.true(filenameScore > 0);
	t.true(pathScore > 0);
});

test('fuzzyScoreFilePath - handles paths with multiple slashes', t => {
	const score = fuzzyScoreFilePath('a/b/c/d/file.ts', 'file');
	t.true(score > 0);
});

test('fuzzyScoreFilePath - case insensitive for paths', t => {
	const score1 = fuzzyScoreFilePath('src/Utils/Helper.ts', 'helper');
	const score2 = fuzzyScoreFilePath('src/utils/helper.ts', 'HELPER');
	t.true(score1 > 0);
	t.true(score2 > 0);
});

// Command-specific test scenarios
test('command matching - /h matches help, status does not', t => {
	const helpScore = fuzzyScore('help', 'h');
	const statusScore = fuzzyScore('status', 'h');
	t.true(helpScore > 0);
	t.is(statusScore, 0);
});

test('command matching - /st matches status', t => {
	const score = fuzzyScore('status', 'st');
	t.true(score > 0);
	t.true(score >= 800); // Should be prefix match
});

test('command matching - /mod matches model', t => {
	const modelScore = fuzzyScore('model', 'mod');
	const recommendationsScore = fuzzyScore('recommendations', 'mod');

	t.true(modelScore > 0);
	// recommendations doesn't contain 'mod' as substring, so it should be 0 or fuzzy match
	// model should score higher (prefix match)
	t.true(modelScore > recommendationsScore);
});

test('command matching - fuzzy matching for /pvd matches provider', t => {
	const score = fuzzyScore('provider', 'pvd');
	t.true(score > 0);
});

test('command matching - /l should prioritize /lsp over /model', t => {
	const lspScore = fuzzyScore('lsp', 'l');
	const modelScore = fuzzyScore('model', 'l');

	// /lsp starts with 'l' (prefix match: 850)
	// /model ends with 'l' (suffix match: 800)
	// Therefore, /lsp should score higher
	t.true(lspScore > modelScore);
	t.is(lspScore, 850); // prefix match
	t.is(modelScore, 800); // suffix match
});

test('command matching - /init matches init higher than initialization', t => {
	const initScore = fuzzyScore('init', 'init');
	const initializationScore = fuzzyScore('initialization', 'init');

	t.true(initScore > initializationScore);
});

// Edge cases
test('fuzzyScore - single character queries work', t => {
	const score1 = fuzzyScore('help', 'h');
	const score2 = fuzzyScore('status', 's');
	t.true(score1 > 0);
	t.true(score2 > 0);
});

test('fuzzyScore - longer text with short query', t => {
	const score = fuzzyScore('very-long-command-name-here', 'vlc');
	t.true(score > 0);
});

test('fuzzyScoreFilePath - works with Windows-style paths', t => {
	// While the function uses /, testing that it handles edge cases
	const score = fuzzyScoreFilePath('src\\utils\\file.ts', 'file');
	t.true(score > 0);
});
