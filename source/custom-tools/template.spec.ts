import test from 'ava';
import {
	cmdQuote,
	findUnsafePlaceholder,
	renderBody,
	renderValue,
	shellQuote,
} from './template';

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

test('cmdQuote preserves metacharacters and embedded quotes', t => {
	t.is(
		cmdQuote('a&b|c<d>e^f"g'),
		'"a&b|c<d>e^f""g"',
	);
});

test('cmdQuote rejects values cmd.exe cannot quote safely', t => {
	for (const value of ['%PATH%', 'a\nb', 'a\rb', 'a\0b']) {
		t.throws(() => cmdQuote(value), {message: /cannot contain/});
	}
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

test('renderBody supports cmd.exe quoting', t => {
	const out = renderBody('echo {{ value }}', {value: 'a&"quoted"'}, cmdQuote);
	t.is(out, 'echo "a&""quoted"""');
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

test('renderBody inverted section: included only when falsy', t => {
	const tpl = `{{^ flag }}off{{/ flag }}`;
	t.is(renderBody(tpl, {flag: false}), 'off');
	t.is(renderBody(tpl, {}), 'off');
	t.is(renderBody(tpl, {flag: ''}), 'off');
	t.is(renderBody(tpl, {flag: true}), '');
	t.is(renderBody(tpl, {flag: 'x'}), '');
});

// ---------------------------------------------------------------------------
// findUnsafePlaceholder
// ---------------------------------------------------------------------------

const posixSafe = [
	'echo {{ q }}',
	'kubectl get pods -n {{ ns }} {{# sel }}-l {{ sel }}{{/ sel }}',
	`echo "literal" {{ q }} 'also literal'`,
	'q={{ q }}; echo "$q"',
	'echo $(printf %s {{ q }})',
	'echo `printf %s {{ q }}`',
	'echo "$(printf %s {{ q }})" ',
	'echo $(( 1 + 2 )) {{ q }}',
	"# don't worry\necho {{ q }}",
	'echo a#b {{ q }}',
	'cat <<EOF\nit\'s "fine"\nEOF\necho {{ q }}',
	'cat <<-\'END\'\n\tliteral $x\n\tEND\necho {{ q }}',
	'grep -c x <<< {{ q }}',
	"awk '{print $1}' {{ file }}",
	'echo \\" {{ q }}',
	// The workaround docs/features/custom-tools.md recommends.
	'q={{ q }}\ngrep -rn "TODO: $q" .\ncat <<EOF\nSearching for $q\nEOF\n',
];

for (const body of posixSafe) {
	test(`findUnsafePlaceholder accepts: ${JSON.stringify(body)}`, t => {
		t.is(findUnsafePlaceholder(body, 'posix'), undefined);
	});
}

const posixUnsafe: Array<[string, RegExp]> = [
	['echo "{{ q }}"', /inside a "\.\.\." string/],
	["echo '{{ q }}'", /inside a '\.\.\.' string/],
	['echo "a $(printf %s "{{ q }}") b"', /inside a "\.\.\." string/],
	['echo `echo "{{ q }}"`', /inside a "\.\.\." string/],
	["echo $'x{{ q }}'", /\$'\.\.\.'/],
	['echo ${X:-{{ q }}}', /\$\{\.\.\.\}/],
	['echo hi # {{ q }}', /comment/],
	['cat <<EOF\n{{ q }}\nEOF', /here-document/],
	["cat <<'EOF'\nvalue: {{ q }}\nEOF", /here-document/],
	['echo \\{{ q }}', /backslash/],
	['echo ${{ q }}', /follows a \$/],
	[
		"echo {{# a }}'{{/ a }}{{ q }}{{# a }}'{{/ a }}",
		/different quoting contexts/,
	],
];

for (const [body, reason] of posixUnsafe) {
	test(`findUnsafePlaceholder rejects: ${JSON.stringify(body)}`, t => {
		const problem = findUnsafePlaceholder(body, 'posix');
		t.truthy(problem);
		t.regex(problem ?? '', reason);
	});
}

test('findUnsafePlaceholder: rejected bodies really are injectable', t => {
	// Document why: what each rejected shape renders to.
	t.is(
		renderBody('echo "{{ q }}"', {q: '$(id)'}),
		`echo "'$(id)'"`,
		'the $(id) sits inside double quotes, so the shell runs it',
	);
	t.is(
		renderBody("echo '{{ q }}'", {q: '; id'}),
		`echo ''; id''`,
		'the author quote closes before the value, so ; id runs',
	);
});

test('findUnsafePlaceholder cmd.exe rules', t => {
	t.is(findUnsafePlaceholder('echo {{ q }}', 'cmd'), undefined);
	t.is(findUnsafePlaceholder('echo "x" {{ q }} "y"', 'cmd'), undefined);
	t.is(findUnsafePlaceholder("echo '{{ q }}'", 'cmd'), undefined);
	t.regex(
		findUnsafePlaceholder('echo "{{ q }}"', 'cmd') ?? '',
		/inside a "\.\.\." string/,
	);
	t.regex(findUnsafePlaceholder('echo ^{{ q }}', 'cmd') ?? '', /follows a \^/);
	t.regex(
		findUnsafePlaceholder('echo {{# a }}"{{/ a }} {{ q }}', 'cmd') ?? '',
		/different quoting contexts/,
	);
});

test('renderBody positive and inverted sections on the same var', t => {
	const tpl = `{{# json }}A {{ id }}{{/ json }}{{^ json }}B {{ id }}{{/ json }}`;
	t.is(renderBody(tpl, {id: '1', json: true}), "A '1'");
	t.is(renderBody(tpl, {id: '1', json: false}), "B '1'");
});
