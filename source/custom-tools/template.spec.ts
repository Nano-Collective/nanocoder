import test from 'ava';
import {renderBody, renderValue, shellQuote} from './template';

console.log('\ncustom-tools/template.spec.ts');

test('shellQuote wraps in single quotes', t => {
	t.is(shellQuote('hello'), `'hello'`);
});

test('shellQuote escapes embedded single quotes', t => {
	t.is(shellQuote(`it's a test`), `'it'\\''s a test'`);
});

test('shellQuote neutralizes injection metacharacters', t => {
	const dangerous = `; rm -rf /`;
	const quoted = shellQuote(dangerous);
	// The shell should see one single-quoted argument, not three commands.
	t.is(quoted, `'; rm -rf /'`);
});

test('shellQuote handles backticks and $()', t => {
	t.is(shellQuote('`whoami`'), `'\`whoami\`'`);
	t.is(shellQuote('$(whoami)'), `'$(whoami)'`);
});

test('shellQuote handles newlines', t => {
	t.is(shellQuote('a\nb'), `'a\nb'`);
});

test('renderValue handles arrays', t => {
	t.is(renderValue(['a', 'b c', "d'e"]), `'a' 'b c' 'd'\\''e'`);
});

test('renderValue handles numbers and booleans', t => {
	t.is(renderValue(42), `'42'`);
	t.is(renderValue(true), `'true'`);
});

test('renderBody substitutes parameters with shell-quoted values', t => {
	const out = renderBody('echo {{ msg }}', {msg: "hi'there"});
	t.is(out, `echo 'hi'\\''there'`);
});

test('renderBody leaves unknown placeholders empty', t => {
	const out = renderBody('echo {{ missing }}', {});
	t.is(out, 'echo ');
});

test('renderBody supports conditional sections', t => {
	const tpl = `kubectl get pods{{# selector }} -l "{{ selector }}"{{/ selector }}`;
	t.is(renderBody(tpl, {}), 'kubectl get pods');
	t.is(
		renderBody(tpl, {selector: 'app=api'}),
		`kubectl get pods -l "'app=api'"`,
	);
});

test('renderBody injection vectors — no command execution leakage', t => {
	const tpl = `echo {{ name }}`;
	const malicious = `; rm -rf /; echo "pwned"`;
	const out = renderBody(tpl, {name: malicious});
	// Whole thing must be inside a single-quoted string.
	t.is(out, `echo '; rm -rf /; echo "pwned"'`);
});

test('renderBody injection vectors — backticks and $()', t => {
	const out = renderBody('echo {{ x }}', {x: '`$(date)`'});
	t.is(out, `echo '\`$(date)\`'`);
});

test('renderBody section: empty string is treated as absent', t => {
	const tpl = `a {{# foo }}YES{{/ foo }}b`;
	t.is(renderBody(tpl, {foo: ''}), 'a b');
});

test('renderBody section: empty array is treated as absent', t => {
	const tpl = `a {{# foo }}YES{{/ foo }}b`;
	t.is(renderBody(tpl, {foo: []}), 'a b');
});

test('renderBody section: zero is treated as absent', t => {
	const tpl = `a {{# foo }}YES{{/ foo }}b`;
	t.is(renderBody(tpl, {foo: 0}), 'a b');
});

test('renderBody nested sections', t => {
	const tpl = `{{# a }}A{{# b }}B{{/ b }}{{/ a }}`;
	t.is(renderBody(tpl, {a: true, b: true}), 'AB');
	t.is(renderBody(tpl, {a: true, b: false}), 'A');
	t.is(renderBody(tpl, {a: false, b: true}), '');
});
