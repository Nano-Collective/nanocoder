import {createHash} from 'node:crypto';
import test from 'ava';
import type {Message} from '@/types/index';
import {renderShareHtml} from './share-html';
import {buildSharePayload} from './share-payload';

console.log('\nshare-html.spec.ts');

function render(
	messages: Message[],
	options: {redact?: boolean; provider?: string; model?: string} = {},
): string {
	const {payload} = buildSharePayload(
		messages,
		{provider: options.provider ?? 'ollama', model: options.model ?? 'qwen'},
		{redact: options.redact ?? true, env: {}},
	);
	return renderShareHtml(payload);
}

const HOSTILE = `</script><script>alert(1)</script><img src=x onerror="alert('x')"> & </style>`;

test('page is a complete HTML document with a strict CSP', t => {
	const html = render([{role: 'user', content: 'Hello'}]);

	t.true(html.startsWith('<!doctype html>\n'));
	t.true(html.endsWith('</html>\n'));
	const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(
		html,
	)?.[1];
	t.truthy(csp);
	t.true(csp?.includes("default-src 'none'"));
	t.true(csp?.includes("base-uri 'none'"));
	t.true(csp?.includes("form-action 'none'"));
	t.false(csp?.includes('unsafe-inline'));
	t.false(csp?.includes('script-src'));
});

test('the CSP style hash matches the inline stylesheet', t => {
	const html = render([{role: 'user', content: 'Hello'}]);
	const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
	const hash = createHash('sha256').update(style, 'utf8').digest('base64');
	t.true(html.includes(`style-src 'sha256-${hash}'`));
});

test('page has no scripts, external URLs or event handlers', t => {
	const html = render([
		{role: 'user', content: HOSTILE},
		{
			role: 'assistant',
			content: HOSTILE,
			reasoning: HOSTILE,
			tool_calls: [
				{id: 'c', function: {name: HOSTILE, arguments: {command: HOSTILE}}},
			],
		},
		{role: 'tool', tool_call_id: 'c', name: HOSTILE, content: HOSTILE},
		{role: 'tool', tool_call_id: 'orphan', name: HOSTILE, content: HOSTILE},
	]);

	t.false(/<script/i.test(html));
	t.false(/<img/i.test(html));
	// An event-handler attribute inside a real tag (escaped text is inert).
	t.false(/<[a-z][^<>]*\son\w+\s*=/i.test(html));
	t.false(/https?:\/\//i.test(html));
	t.is((html.match(/<\/style>/g) ?? []).length, 1);
	t.true(html.includes('&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
	t.true(html.includes('onerror=&quot;alert(&#39;x&#39;)&quot;'));
});

test('provider, model, title and code-fence language are escaped', t => {
	const html = render(
		[
			{role: 'user', content: '<b>title</b>\nmore'},
			{role: 'assistant', content: '```"><i>\ncode\n```'},
		],
		{provider: '<p>', model: '"m"'},
	);
	t.true(html.includes('<title>&lt;b&gt;title&lt;/b&gt; · Nanocoder session</title>'));
	t.true(html.includes('&lt;p&gt; · &quot;m&quot;'));
	t.true(html.includes('<div class="lang">&quot;&gt;&lt;i&gt;</div>'));
	t.false(html.includes('<b>'));
	t.false(html.includes('<i>'));
});

test('rendering is deterministic', t => {
	const messages: Message[] = [
		{role: 'user', content: 'Hi'},
		{
			role: 'assistant',
			content: 'Listing',
			tool_calls: [{id: 'c', function: {name: 'list', arguments: {b: 1, a: 2}}}],
		},
		{role: 'tool', tool_call_id: 'c', name: 'list', content: 'a\nb'},
	];
	t.is(render(messages), render(messages));
});

test('a tool result is shown inside the call it answers', t => {
	const html = render([
		{role: 'user', content: 'Check'},
		{
			role: 'assistant',
			content: 'Running',
			tool_calls: [
				{
					id: 'c1',
					function: {name: 'execute_bash', arguments: {command: 'ls -la'}},
				},
			],
		},
		{role: 'tool', tool_call_id: 'c1', name: 'execute_bash', content: 'file.txt'},
	]);

	const details = /<details><summary><span class="tool-name">execute_bash<\/span> <span class="preview">ls -la<\/span><\/summary>([\s\S]*?)<\/details>/.exec(
		html,
	);
	t.truthy(details);
	t.true(details?.[1]?.includes('<pre>file.txt</pre>'));
	t.true(details?.[1]?.includes('&quot;command&quot;: &quot;ls -la&quot;'));
	// Paired results are not repeated as their own message.
	t.false(html.includes('class="msg tool"'));
});

test('a reused call id pairs each result with the call before it', t => {
	const html = render([
		{role: 'user', content: 'Twice'},
		{
			role: 'assistant',
			content: '',
			tool_calls: [{id: 'call_0', function: {name: 'first', arguments: {}}}],
		},
		{role: 'tool', tool_call_id: 'call_0', name: 'first', content: 'one'},
		{
			role: 'assistant',
			content: '',
			tool_calls: [{id: 'call_0', function: {name: 'second', arguments: {}}}],
		},
		{role: 'tool', tool_call_id: 'call_0', name: 'second', content: 'two'},
	]);
	t.regex(html, /first<\/span><\/summary>(?:(?!<\/details>)[\s\S])*<pre>one<\/pre>/);
	t.regex(html, /second<\/span><\/summary>(?:(?!<\/details>)[\s\S])*<pre>two<\/pre>/);
});

test('a second result for the same call is shown on its own', t => {
	const html = render([
		{role: 'user', content: 'Go'},
		{
			role: 'assistant',
			content: '',
			tool_calls: [{id: 'dup', function: {name: 'run', arguments: {}}}],
		},
		{role: 'tool', tool_call_id: 'dup', name: 'run', content: 'first'},
		{role: 'tool', tool_call_id: 'dup', name: 'run', content: 'second'},
	]);
	t.regex(html, /run<\/span><\/summary>(?:(?!<\/details>)[\s\S])*<pre>first<\/pre>/);
	t.true(
		html.includes(
			'<article class="msg tool"><div class="role">Tool result: run</div><pre>second</pre></article>',
		),
	);
});

test('unpaired calls and results are still shown', t => {
	const html = render([
		{role: 'user', content: 'Go'},
		{
			role: 'assistant',
			content: '',
			tool_calls: [{id: 'lost', function: {name: 'read_file', arguments: {}}}],
		},
		{role: 'tool', tool_call_id: 'other', name: 'web_fetch', content: 'page'},
		{role: 'tool', tool_call_id: 'quiet', name: 'noop', content: ''},
	]);
	t.true(html.includes('No result was recorded for this call.'));
	t.true(html.includes('<div class="role">Tool result: web_fetch</div><pre>page</pre>'));
	t.true(html.includes('The tool returned no output.'));
});

test('fenced code blocks are set apart, other markdown stays as text', t => {
	const html = render([
		{role: 'user', content: 'Show me'},
		{
			role: 'assistant',
			content: 'Here:\n\n```ts\nconst a = 1;\n```\n\n**Done** with `inline`',
		},
		{role: 'assistant', content: 'Unclosed:\n~~~\nstill code'},
	]);
	t.true(html.includes('<div class="text">Here:</div>'));
	t.true(
		html.includes(
			'<div class="code"><div class="lang">ts</div><pre><code>const a = 1;</code></pre></div>',
		),
	);
	t.true(html.includes('<div class="text">**Done** with `inline`</div>'));
	t.true(html.includes('<pre><code>still code</code></pre>'));
});

test('header reports counts and whether secrets were redacted', t => {
	const messages: Message[] = [
		{role: 'user', content: 'One'},
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{id: 'a', function: {name: 'x', arguments: {}}},
				{id: 'b', function: {name: 'y', arguments: {}}},
			],
		},
		{role: 'user', content: 'Two'},
	];
	t.true(
		render(messages).includes(
			'<p class="meta">ollama · qwen · 2 prompts · 2 tool calls · secrets redacted</p>',
		),
	);
	t.true(render(messages, {redact: false}).includes('secrets NOT redacted'));
});

test('attached images are noted, not embedded', t => {
	const html = render([
		{
			role: 'user',
			content: 'Look',
			images: [
				{data: 'AAAA', mediaType: 'image/png'},
				{data: 'BBBB', mediaType: 'image/png'},
			],
		},
	]);
	t.true(html.includes('2 images attached (image/png), not included in this page.'));
	t.false(html.includes('AAAA'));
});

test('notices and cancelled turns are marked', t => {
	const html = render([
		{role: 'user', content: 'Go'},
		{role: 'assistant', content: 'Stopped', displayOnly: true, outcome: 'cancelled'},
	]);
	t.true(
		html.includes(
			'<article class="msg assistant notice"><div class="role">Assistant<span class="badge">cancelled</span></div>',
		),
	);
});
