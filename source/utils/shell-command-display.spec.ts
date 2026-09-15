import test from 'ava';
import {splitCommandForDisplay} from './shell-command-display';

console.log('\nshell-command-display.spec.ts');

// ============================================================================
// Splitting on top-level `;`
// ============================================================================

test('splits top-level ;-separated commands onto separate lines', t => {
	t.deepEqual(
		splitCommandForDisplay(
			'dolt version; echo "==="; ls -la /usr/local/bin/dolt',
		),
		['dolt version;', 'echo "===";', 'ls -la /usr/local/bin/dolt'],
	);
});

test('splits a simple compound command', t => {
	t.deepEqual(splitCommandForDisplay('a; b; c'), ['a;', 'b;', 'c']);
});

test('keeps a trailing ; on its own segment', t => {
	t.deepEqual(splitCommandForDisplay('ls;'), ['ls;']);
});

test('trims whitespace around each segment', t => {
	t.deepEqual(splitCommandForDisplay('  a  ;  b  '), ['a;', 'b']);
});

// ============================================================================
// Quoted / escaped ; must be left alone
// ============================================================================

test('does not split a quoted semicolon', t => {
	t.deepEqual(splitCommandForDisplay('echo "hello; world"'), [
		'echo "hello; world"',
	]);
});

test('does not split a semicolon inside single quotes', t => {
	t.deepEqual(splitCommandForDisplay("awk '{print $1; print $2}' file"), [
		"awk '{print $1; print $2}' file",
	]);
});

test('does not split an escaped semicolon', t => {
	t.deepEqual(
		splitCommandForDisplay('find . -name "*.tmp" -exec rm {} \\;'),
		['find . -name "*.tmp" -exec rm {} \\;'],
	);
});

test('does not split a semicolon in a quoted commit message', t => {
	t.deepEqual(splitCommandForDisplay('git commit -m "fix; refactor"'), [
		'git commit -m "fix; refactor"',
	]);
});

// ============================================================================
// Regions where `;` is not a statement separator (kept on one segment)
// ============================================================================

test('keeps a semicolon inside command substitution', t => {
	t.deepEqual(splitCommandForDisplay('echo $(a; b); ls'), ['echo $(a; b);', 'ls']);
});

test('keeps a semicolon inside a subshell', t => {
	t.deepEqual(splitCommandForDisplay('(a; b); c'), ['(a; b);', 'c']);
});

test('keeps a semicolon inside a brace group', t => {
	t.deepEqual(splitCommandForDisplay('{ a; b; }; c'), ['{ a; b; };', 'c']);
});

test('keeps a semicolon inside backticks', t => {
	t.deepEqual(splitCommandForDisplay('echo `a; b`; ls'), ['echo `a; b`;', 'ls']);
});

test('keeps a semicolon inside parameter expansion', t => {
	t.deepEqual(splitCommandForDisplay('echo ${VAR:-a;b}; ls'), [
		'echo ${VAR:-a;b};',
		'ls',
	]);
});

test('splits around command substitution in a realistic command', t => {
	const command =
		'cd /x && ls -la y 2>&1; echo "---"; NPM_BIN=$(dirname "$(which n)"); find z';
	t.deepEqual(splitCommandForDisplay(command), [
		'cd /x && ls -la y 2>&1;',
		'echo "---";',
		'NPM_BIN=$(dirname "$(which n)");',
		'find z',
	]);
});

test('keeps a semicolon inside nested substitution', t => {
	t.deepEqual(splitCommandForDisplay('x=$(a; $(b; c)); y'), [
		'x=$(a; $(b; c));',
		'y',
	]);
});

test('honors an escaped quote inside double quotes', t => {
	t.deepEqual(splitCommandForDisplay('echo "say \\"hi\\"; again"; ls'), [
		'echo "say \\"hi\\"; again";',
		'ls',
	]);
});

test('does not treat region chars inside quotes as regions', t => {
	t.deepEqual(splitCommandForDisplay('echo "{a; b} (c; d)"; ls'), [
		'echo "{a; b} (c; d)";',
		'ls',
	]);
});

test('does not split on && or || (only ; is a separator)', t => {
	t.deepEqual(splitCommandForDisplay('cd x && make; ls'), ['cd x && make;', 'ls']);
	t.deepEqual(splitCommandForDisplay('a || b; c'), ['a || b;', 'c']);
});

test('leaves an empty command unchanged', t => {
	t.deepEqual(splitCommandForDisplay(''), ['']);
	t.deepEqual(splitCommandForDisplay('   '), ['   ']);
});

// ============================================================================
// Constructs where `;` is not a statement separator → bail, unchanged
// ============================================================================

test('leaves a for loop unchanged', t => {
	t.deepEqual(splitCommandForDisplay('for f in *.ts; do echo $f; done'), [
		'for f in *.ts; do echo $f; done',
	]);
});

test('leaves a heredoc unchanged', t => {
	const command = 'cat <<EOF\nhello; world\nEOF';
	t.deepEqual(splitCommandForDisplay(command), [command]);
});

test('leaves unbalanced brackets unchanged', t => {
	t.deepEqual(splitCommandForDisplay('echo (a; b'), ['echo (a; b']);
});

test('leaves an unterminated quote unchanged', t => {
	t.deepEqual(splitCommandForDisplay('echo "unterminated; ls'), [
		'echo "unterminated; ls',
	]);
});

test('leaves a plain single command unchanged', t => {
	t.deepEqual(splitCommandForDisplay('ls -la'), ['ls -la']);
});

