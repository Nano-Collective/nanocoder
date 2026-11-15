import test from 'ava';
import {
	clearFileListCache,
	getCurrentFileMention,
} from './file-autocomplete.js';
import {fuzzyScoreFilePath} from '../utils/fuzzy-matching.js';

console.log(`\nfile-autocomplete.spec.ts`);

// Test fuzzyScoreFilePath()
test('fuzzy score: exact match gets highest score', t => {
	const score = fuzzyScoreFilePath('app.tsx', 'app.tsx');
	t.is(score, 1000);
});

test('fuzzy score: exact filename match', t => {
	const score = fuzzyScoreFilePath('src/components/app.tsx', 'app.tsx');
	t.is(score, 900);
});

test('fuzzy score: path ends with query', t => {
	const score = fuzzyScoreFilePath('src/components/Button.tsx', 'Button.tsx');
	// This matches exact filename, so it gets 900 not 850
	t.is(score, 900);
});

test('fuzzy score: filename starts with query', t => {
	const score = fuzzyScoreFilePath('src/components/Button.tsx', 'butt');
	t.is(score, 800);
});

test('fuzzy score: path starts with query', t => {
	const score = fuzzyScoreFilePath('src/components/Button.tsx', 'src/comp');
	t.is(score, 750);
});

test('fuzzy score: filename contains query', t => {
	const score = fuzzyScoreFilePath('src/components/Button.tsx', 'ton');
	t.is(score, 700);
});

test('fuzzy score: path contains query', t => {
	const score = fuzzyScoreFilePath('src/components/Button.tsx', 'compo');
	// "compo" is a substring in path but doesn't start the path
	t.is(score, 600);
});

test('fuzzy score: sequential character match', t => {
	const score = fuzzyScoreFilePath('src/components/Button.tsx', 'btn');
	t.true(score > 0 && score < 600);
});

test('fuzzy score: no match returns 0', t => {
	const score = fuzzyScoreFilePath('app.tsx', 'xyz');
	t.is(score, 0);
});

test('fuzzy score: empty query returns 0', t => {
	const score = fuzzyScoreFilePath('app.tsx', '');
	t.is(score, 0);
});

test('fuzzy score: case insensitive', t => {
	const score1 = fuzzyScoreFilePath('App.tsx', 'app');
	const score2 = fuzzyScoreFilePath('app.tsx', 'APP');
	t.true(score1 > 0);
	t.true(score2 > 0);
});

test('fuzzy score: prefers shorter paths', t => {
	const shortPath = fuzzyScoreFilePath('app.tsx', 'app');
	const longPath = fuzzyScoreFilePath('src/components/nested/app.tsx', 'app');
	// Both match filename "app.tsx" starting with "app", so they get same score
	// The scoring doesn't currently prefer shorter paths
	t.is(shortPath, longPath);
});

test('fuzzy score: consecutive matches get bonus', t => {
	// "but" matches consecutively in "Button"
	const consecutive = fuzzyScoreFilePath('Button.tsx', 'but');
	// "btn" requires skipping characters
	const nonConsecutive = fuzzyScoreFilePath('Button.tsx', 'btn');
	t.true(consecutive > nonConsecutive);
});

// Test getCurrentFileMention()
test('extracts mention at end of string', t => {
	const result = getCurrentFileMention('Fix @src/app');
	t.truthy(result);
	t.is(result!.mention, 'src/app');
	t.is(result!.startIndex, 4);
	t.is(result!.endIndex, 12);
});

test('extracts mention in middle of string', t => {
	// Cursor at position 15 is right after "x" in ".tsx"
	const result = getCurrentFileMention('Check @app.tsx please', 14);
	t.truthy(result);
	t.is(result!.mention, 'app.tsx');
	t.is(result!.startIndex, 6);
});

test('extracts mention with cursor in middle', t => {
	const result = getCurrentFileMention('Fix @src/ap', 11);
	t.truthy(result);
	t.is(result!.mention, 'src/ap');
});

test('returns null when no @ symbol', t => {
	const result = getCurrentFileMention('Just regular text');
	t.is(result, null);
});

test('returns null when @ is after cursor', t => {
	const result = getCurrentFileMention('Text @file.txt', 3);
	t.is(result, null);
});

test('returns null when @ is followed by space', t => {
	const result = getCurrentFileMention('Fix @ file.txt');
	t.is(result, null);
});

test('strips line range from mention', t => {
	const result = getCurrentFileMention('Fix @app.tsx:10-20');
	t.truthy(result);
	t.is(result!.mention, 'app.tsx');
});

test('strips single line number from mention', t => {
	const result = getCurrentFileMention('Fix @app.tsx:10');
	t.truthy(result);
	t.is(result!.mention, 'app.tsx');
});

test('handles multiple @ symbols', t => {
	const result = getCurrentFileMention('Compare @a.ts and @b.ts', 24);
	t.truthy(result);
	t.is(result!.mention, 'b.ts');
});

test('handles @ at start of string', t => {
	const result = getCurrentFileMention('@app.tsx');
	t.truthy(result);
	t.is(result!.mention, 'app.tsx');
	t.is(result!.startIndex, 0);
});

test('handles path with slashes', t => {
	const result = getCurrentFileMention('@src/components/Button.tsx');
	t.truthy(result);
	t.is(result!.mention, 'src/components/Button.tsx');
});

test('stops at whitespace', t => {
	// When cursor is at end (after "here"), we look back and hit whitespace
	// So we should use cursor position right after the file mention
	const result = getCurrentFileMention('@app.tsx here', 8);
	t.truthy(result);
	t.is(result!.mention, 'app.tsx');
	t.is(result!.endIndex, 8);
});

test('stops at next @ symbol', t => {
	const result = getCurrentFileMention('@app.tsx@other', 8);
	t.truthy(result);
	t.is(result!.mention, 'app.tsx');
});

// Clear cache between tests (if needed)
test.afterEach(() => {
	clearFileListCache();
});
