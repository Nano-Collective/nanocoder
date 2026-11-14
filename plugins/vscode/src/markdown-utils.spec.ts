import test from 'ava';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Loaded untyped: @types/jsdom pulls the DOM lib into this Node-only program,
// where its stream types clash with node:stream/web.
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
	JSDOM: new (html: string, options: { runScripts: 'outside-only' }) => { window: any };
};

/**
 * `media/markdown-utils.js` ships as a plain browser script next to the
 * vendored marked and DOMPurify builds. DOMPurify needs a real DOM, so all
 * three are loaded into a jsdom window in the same order chat-panel.html
 * loads them.
 */
const media = (name: string) =>
	readFileSync(fileURLToPath(new URL(`../media/${name}`, import.meta.url)), 'utf8');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
	runScripts: 'outside-only',
});
dom.window.eval(media('marked.min.js'));
dom.window.eval(media('purify.min.js'));
dom.window.eval(media('markdown-utils.js'));

const win = dom.window as any;
const { renderMarkdown } = win.NanocoderMarkdownUtils;

const render = (markdown: string): string =>
	renderMarkdown(markdown, win.marked, win.DOMPurify);

/** Parse rendered HTML back into a fragment, so tests assert on the DOM. */
const parse = (html: string) => {
	const template = win.document.createElement('template');
	template.innerHTML = html;
	return template.content;
};

// ── what is removed ───────────────────────────────────────

test('renderMarkdown - strips script tags and inline event handlers', t => {
	const html = render('<script>alert(1)</script><img src="x.png" onerror="alert(1)">');
	const fragment = parse(html);

	t.is(fragment.querySelector('script'), null);
	t.false(html.includes('onerror'));
	t.truthy(fragment.querySelector('img'));
});

test('renderMarkdown - strips style tags and style attributes', t => {
	// Mid-paragraph: a leading <style> lands in <head> and DOMPurify drops it
	// regardless, which would hide a missing FORBID_TAGS entry.
	const html = render(
		'hello <style>body { display: none }</style>\n\n<p style="position:fixed;inset:0">x</p>',
	);
	const fragment = parse(html);

	t.is(fragment.querySelector('style'), null);
	t.is(fragment.querySelector('p')?.getAttribute('style'), null);
});

test('renderMarkdown - drops panel utility classes from raw HTML', t => {
	const html = render('<div class="fixed inset-0 z-50 bg-vscode-bg">cover</div>');
	const div = parse(html).querySelector('div');

	t.truthy(div);
	t.false(div!.hasAttribute('class'));
});

test('renderMarkdown - prefixes ids so they cannot shadow panel elements', t => {
	const html = render('<div id="messages-container">x</div>');
	const div = parse(html).querySelector('div');

	t.is(div?.id, 'user-content-messages-container');
});

test('renderMarkdown - removes SVG and forms', t => {
	const html = render(
		'<svg><a href="https://example.com"><text>hi</text></a></svg>\n\n<form action="https://example.com"><button>go</button></form>',
	);
	const fragment = parse(html);

	t.is(fragment.querySelector('svg'), null);
	t.is(fragment.querySelector('form'), null);
});

test('renderMarkdown - removes javascript: and command: links', t => {
	const html = render('[a](javascript:alert(1)) [b](command:workbench.action.quit)');
	const links = [...parse(html).querySelectorAll('a')];

	t.is(links.length, 2);
	for (const link of links) t.is(link.getAttribute('href'), null);
});

// ── what still renders ────────────────────────────────────

test('renderMarkdown - keeps fenced code blocks and their language class', t => {
	const html = render('```ts\nconst a = 1 < 2;\n```');
	const code = parse(html).querySelector('pre > code');

	t.truthy(code);
	t.is(code!.className, 'language-ts');
	t.is(code!.textContent, 'const a = 1 < 2;\n');
});

test('renderMarkdown - keeps inline code, emphasis, lists and tables', t => {
	const html = render(
		'Use `pnpm` **now**\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |',
	);
	const fragment = parse(html);

	t.is(fragment.querySelector('code')?.textContent, 'pnpm');
	t.is(fragment.querySelector('strong')?.textContent, 'now');
	t.is(fragment.querySelectorAll('li').length, 2);
	t.is(fragment.querySelectorAll('td').length, 2);
});

test('renderMarkdown - keeps https links', t => {
	const html = render('[docs](https://example.com/docs)');
	const link = parse(html).querySelector('a');

	t.is(link?.getAttribute('href'), 'https://example.com/docs');
	t.is(link?.textContent, 'docs');
});

// ── fail closed ───────────────────────────────────────────

test('renderMarkdown - returns null without DOMPurify', t => {
	t.is(renderMarkdown('**x**', win.marked, undefined), null);
});

test('renderMarkdown - returns null when DOMPurify reports no DOM support', t => {
	const unsupported = {
		isSupported: false,
		addHook() {},
		sanitize: (html: string) => html,
	};
	t.is(renderMarkdown('<b>x</b>', win.marked, unsupported), null);
});

test('renderMarkdown - returns null without marked', t => {
	t.is(renderMarkdown('**x**', undefined, win.DOMPurify), null);
});

// ── webview wiring ────────────────────────────────────────

test('chat-panel.html - CSP does not allow remote images', t => {
	const html = media('chat-panel.html');
	const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
	const imgSrc = csp?.split(';').find(directive => directive.trim().startsWith('img-src'));

	t.truthy(imgSrc);
	t.false(/\bhttps?:/.test(imgSrc!));
});

test('chat-panel.html - loads the sanitizer before the panel script', t => {
	const html = media('chat-panel.html');
	const order = ['{{markedUri}}', '{{purifyUri}}', '{{markdownUtilsUri}}', '{{scriptUri}}'].map(
		placeholder => html.indexOf(`src="${placeholder}"`),
	);

	t.false(order.includes(-1));
	t.deepEqual([...order].sort((a, b) => a - b), order);
});
