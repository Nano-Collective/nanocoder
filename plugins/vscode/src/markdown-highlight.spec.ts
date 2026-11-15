import test from 'ava';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/**
 * The webview scripts ship as plain browser scripts, so they are loaded into a
 * VM context (the way the panel loads them) rather than imported. This runs the
 * real marked, the real highlight.js bundle and the helper together.
 */
const read = (name: string): string =>
	readFileSync(fileURLToPath(new URL(`../media/${name}`, import.meta.url)), 'utf8');

interface Marked {
	parse(text: string): string;
}

/** A fresh panel-like context per test: `marked.use` mutates the global marked. */
function loadPanel(withHighlighter = true): {
	marked: Marked;
	helper: {
		highlightCode(hljs: unknown, code: string, lang: string): string;
		configureMarkdown(marked: unknown, hljs: unknown): void;
	};
	hljs: unknown;
} {
	const ctx = vm.createContext({});
	vm.runInContext(read('marked.min.js'), ctx);
	if (withHighlighter) vm.runInContext(read('highlight.min.js'), ctx);
	vm.runInContext(read('markdown-highlight.js'), ctx);
	const sandbox = ctx as {
		marked: Marked;
		hljs?: unknown;
		NanocoderMarkdownHighlight: ReturnType<typeof loadPanel>['helper'];
	};
	sandbox.NanocoderMarkdownHighlight.configureMarkdown(sandbox.marked, sandbox.hljs);
	return { marked: sandbox.marked, helper: sandbox.NanocoderMarkdownHighlight, hljs: sandbox.hljs };
}

const fence = '```';

const entities: Record<string, string> = {
	lt: '<',
	gt: '>',
	quot: '"',
	'#39': "'",
	amp: '&',
};

/**
 * What a reader would copy: tags dropped, entities decoded once, and marked's
 * own trailing newline (after the closing tag) removed. Tags are skipped with a
 * scan, not a regex, so this stays an obvious test helper and not a sanitizer.
 */
function visibleText(html: string): string {
	let text = '';
	let inTag = false;
	for (const char of html) {
		if (char === '<') inTag = true;
		else if (char === '>' && inTag) inTag = false;
		else if (!inTag) text += char;
	}
	return text
		.replace(/&(lt|gt|quot|#39|amp);/g, (_match, name: string) => entities[name])
		.replace(/\n$/, '');
}

test('a closed fence is highlighted inside the usual pre/code markup', t => {
	const { marked } = loadPanel();
	const html = marked.parse(`${fence}python\ndef f():\n    return 1\n${fence}`);

	t.true(html.startsWith('<pre><code class="language-python">'));
	t.true(html.includes('<span class="hljs-keyword">def</span>'));
	t.true(html.includes('<span class="hljs-number">1</span>'));
	t.true(html.endsWith('\n</code></pre>\n'));
});

test('a fence that is still open while streaming is highlighted too', t => {
	const { marked } = loadPanel();
	const html = marked.parse(`Here:\n\n${fence}python\ndef f():\n    return 1`);

	t.true(html.includes('<span class="hljs-keyword">def</span>'));
	t.true(html.includes('<pre><code class="language-python">'));
});

test('an alias typed so far still highlights', t => {
	const { marked } = loadPanel();
	// "py" and "tsx" are aliases, not language names.
	t.true(marked.parse(`${fence}py\nreturn 1\n${fence}`).includes('hljs-'));
	t.true(marked.parse(`${fence}tsx\nconst a = 1;\n${fence}`).includes('hljs-keyword'));
});

test('a language that is still being typed falls back to plain text without throwing', t => {
	const { marked } = loadPanel();

	for (const partial of ['p', 'pyth', 'pythonn']) {
		const html = marked.parse(`${fence}${partial}\nx < 1 && y\n`);
		t.is(html, `<pre><code class="language-${partial}">x &lt; 1 &amp;&amp; y\n</code></pre>\n`);
	}
});

test('language names that exist on Object.prototype are treated as unknown', t => {
	const { marked } = loadPanel();

	for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
		const html = marked.parse(`${fence}${name}\n<b>\n${fence}`);
		t.is(html, `<pre><code class="language-${name}">&lt;b&gt;\n</code></pre>\n`);
	}
});

test('code is HTML-escaped whether or not the language is highlighted', t => {
	const { marked } = loadPanel();
	const payload = '<script>alert(1)</script><img src=x onerror=alert(2)>';

	for (const lang of ['html', 'xml', 'markdown', 'nolang', '']) {
		const html = marked.parse(`${fence}${lang}\n${payload}\n${fence}`);
		t.false(/<(script|img)\b/i.test(html), `raw tag survived for "${lang}"`);
		t.is(visibleText(html), payload + '\n', `text changed for "${lang}"`);
	}
});

test('highlighting never changes the text a reader would copy', t => {
	const { marked } = loadPanel();
	const code = 'const s = "a < b";\nif (x && y) { return `${s}`; }';
	const html = marked.parse(`${fence}ts\n${code}\n${fence}`);

	t.true(html.includes('hljs-'));
	t.is(visibleText(html), `${code}\n`);
});

test('a hostile info string cannot break out of the class attribute', t => {
	const { marked } = loadPanel();
	const html = marked.parse(`${fence}a"onmouseover="x\ncode\n${fence}`);

	t.false(html.includes('" onmouseover'));
	t.true(html.includes('class="language-a&quot;onmouseover=&quot;x"'));
});

test('a fence with no language, and an indented block, stay plain', t => {
	const { marked } = loadPanel();

	t.is(marked.parse(`${fence}\n<b>\n${fence}`), '<pre><code>&lt;b&gt;\n</code></pre>\n');
	t.is(marked.parse('    indented <b>'), '<pre><code>indented &lt;b&gt;\n</code></pre>\n');
});

test('prose and inline code are untouched', t => {
	const { marked } = loadPanel();

	t.is(marked.parse('use `x` here'), '<p>use <code>x</code> here</p>\n');
});

test('without the highlighter library marked keeps its default output', t => {
	const plain = loadPanel(false);
	const input = `${fence}python\nx = 1\n${fence}`;

	t.is(plain.hljs, undefined);
	t.is(plain.marked.parse(input), '<pre><code class="language-python">x = 1\n</code></pre>\n');
});

test('an unknown language never reaches the highlighter', t => {
	// Streaming re-renders every ~50ms; a half-typed name must not throw and
	// catch on each tick.
	const { helper } = loadPanel();
	let calls = 0;
	const spy = {
		getLanguage: () => undefined,
		highlight: () => {
			calls += 1;
			return { value: '' };
		},
	};

	t.is(helper.highlightCode(spy, 'a < b', 'pyth'), 'a &lt; b');
	t.is(calls, 0);
});

test('a highlighter that throws falls back to escaped text', t => {
	const { helper } = loadPanel();
	const broken = {
		getLanguage: () => ({}),
		highlight: () => {
			throw new Error('boom');
		},
	};

	t.is(helper.highlightCode(broken, 'a < b', 'python'), 'a &lt; b');
	t.is(helper.highlightCode(undefined, 'a < b', 'python'), 'a &lt; b');
});
