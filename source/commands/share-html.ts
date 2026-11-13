import {createHash} from 'node:crypto';
import {
	firstUserRequest,
	type JsonValue,
	type SharedMessage,
	type SharedToolCall,
	type SharePayload,
} from '@/commands/share-payload';
import {truncateText} from '@/utils/truncate-text';

/**
 * Render a `/share` payload as one self-contained, static HTML page.
 *
 * The page runs no JavaScript: tool calls and reasoning collapse with native
 * `<details>`, so it works anywhere the file is opened, including previews
 * that block scripts. Every string from the session is HTML-escaped and
 * nothing is rendered as markup (markdown is shown as text, with fenced code
 * blocks set apart). As a second line of defence the Content-Security-Policy
 * allows only the page's own stylesheet, pinned by hash: no scripts, images,
 * fonts, frames or network requests of any kind.
 *
 * The output depends only on the payload, so the same session renders to the
 * same bytes.
 */

const STYLE = `:root{color-scheme:light dark;--bg:#f6f8fa;--fg:#1f2328;--muted:#59636e;--card:#fff;--inset:#f6f8fa;--border:#d1d9e0;--user:#0969da;--assistant:#8250df;--tool:#1a7f37;--notice:#9a6700}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9198a1;--card:#151b23;--inset:#0d1117;--border:#3d444d;--user:#4493f8;--assistant:#ab7df8;--tool:#3fb950;--notice:#d29922}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
header,main,footer{max-width:880px;margin:0 auto;padding:0 16px}
header{padding-top:32px}
h1{font-size:20px;margin:0 0 4px}
.title{margin:0 0 4px;font-weight:600;overflow-wrap:anywhere}
.meta,footer{color:var(--muted);font-size:13px}
.meta{margin:0}
footer{padding-top:8px;padding-bottom:40px}
.msg{background:var(--card);border:1px solid var(--border);border-left:4px solid var(--border);border-radius:8px;padding:12px 16px;margin:16px 0}
.msg.user{border-left-color:var(--user)}
.msg.assistant{border-left-color:var(--assistant)}
.msg.tool{border-left-color:var(--tool)}
.msg.notice{border-left-color:var(--notice)}
.role{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
.badge{margin-left:8px;padding:0 6px;border:1px solid var(--notice);border-radius:4px;color:var(--notice)}
.text{white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0}
pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.code{margin:8px 0;padding:8px 12px;background:var(--inset);border:1px solid var(--border);border-radius:6px}
.lang{font-size:11px;color:var(--muted);margin-bottom:4px}
details{margin:8px 0;background:var(--inset);border:1px solid var(--border);border-radius:6px}
summary{cursor:pointer;padding:6px 10px;font-size:13px;overflow-wrap:anywhere}
.tool-name{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:600;color:var(--tool)}
.preview{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--muted)}
.body{padding:0 10px 10px}
.label{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:8px 0 4px}
.note{color:var(--muted);font-size:13px;font-style:italic;margin:6px 0}`;

const CSP = [
	"default-src 'none'",
	`style-src 'sha256-${createHash('sha256').update(STYLE, 'utf8').digest('base64')}'`,
	"base-uri 'none'",
	"form-action 'none'",
].join('; ');

const HTML_ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
};

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, char => HTML_ESCAPES[char] ?? char);
}

interface Segment {
	kind: 'text' | 'code';
	text: string;
	lang: string;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;

/**
 * Split markdown into prose and fenced code blocks. Only fences are
 * recognised; everything else stays as written. An unclosed fence runs to the
 * end of the message, as in CommonMark.
 */
function splitFences(content: string): Segment[] {
	const segments: Segment[] = [];
	let text: string[] = [];
	let code: string[] | null = null;
	let fence = '';
	let lang = '';

	for (const line of content.split('\n')) {
		if (code === null) {
			const open = FENCE_OPEN.exec(line);
			// A backtick fence's info string cannot contain a backtick, which
			// keeps inline code such as ```x``` on one line from opening a block.
			if (open && !(open[1].startsWith('`') && open[2].includes('`'))) {
				if (text.length > 0) {
					segments.push({kind: 'text', text: text.join('\n'), lang: ''});
					text = [];
				}
				code = [];
				fence = open[1];
				lang = open[2].trim().split(/\s+/)[0] ?? '';
				continue;
			}
			text.push(line);
			continue;
		}

		const close = FENCE_CLOSE.exec(line);
		if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
			segments.push({kind: 'code', text: code.join('\n'), lang});
			code = null;
			continue;
		}
		code.push(line);
	}

	if (code !== null) {
		segments.push({kind: 'code', text: code.join('\n'), lang});
	} else if (text.length > 0) {
		segments.push({kind: 'text', text: text.join('\n'), lang: ''});
	}
	return segments;
}

function renderText(text: string): string {
	const trimmed = text.replace(/^(?:[ \t]*\n)+/, '').trimEnd();
	return trimmed ? `<div class="text">${escapeHtml(trimmed)}</div>` : '';
}

function renderContent(content: string): string {
	return splitFences(content)
		.map(segment => {
			if (segment.kind === 'text') {
				return renderText(segment.text);
			}
			const label = segment.lang
				? `<div class="lang">${escapeHtml(truncateText(segment.lang, 40))}</div>`
				: '';
			return `<div class="code">${label}<pre><code>${escapeHtml(segment.text)}</code></pre></div>`;
		})
		.join('');
}

function renderImages(message: SharedMessage): string {
	const images = message.images ?? [];
	if (images.length === 0) {
		return '';
	}
	const types = [...new Set(images.map(image => image.mediaType))].join(', ');
	const noun = images.length === 1 ? 'image' : 'images';
	return `<p class="note">${images.length} ${noun} attached (${escapeHtml(types)}), not included in this page.</p>`;
}

/** Arguments most worth showing in a collapsed tool call, in order. */
const PREVIEW_KEYS = [
	'command',
	'path',
	'file_path',
	'pattern',
	'query',
	'url',
];

function argumentPreview(args: JsonValue): string {
	if (args === null || typeof args !== 'object' || Array.isArray(args)) {
		return '';
	}
	const key = PREVIEW_KEYS.find(name => typeof args[name] === 'string');
	const value =
		key === undefined
			? Object.values(args).find(item => typeof item === 'string')
			: args[key];
	if (typeof value !== 'string') {
		return '';
	}
	return truncateText(value.replace(/\s+/g, ' ').trim(), 80);
}

function renderToolCall(
	call: SharedToolCall,
	result: SharedMessage | undefined,
): string {
	const preview = argumentPreview(call.arguments);
	const summary =
		`<summary><span class="tool-name">${escapeHtml(call.name)}</span>` +
		(preview ? ` <span class="preview">${escapeHtml(preview)}</span>` : '') +
		'</summary>';
	const args =
		'<div class="label">Arguments</div>' +
		`<pre>${escapeHtml(JSON.stringify(call.arguments, null, 2))}</pre>`;
	let output: string;
	if (!result) {
		output = '<p class="note">No result was recorded for this call.</p>';
	} else if (result.content === '') {
		output = `<p class="note">The tool returned no output.</p>${renderImages(result)}`;
	} else {
		output = `<pre>${escapeHtml(result.content)}</pre>${renderImages(result)}`;
	}
	return `<details>${summary}<div class="body">${args}<div class="label">Result</div>${output}</div></details>`;
}

const ROLE_LABELS: Record<SharedMessage['role'], string> = {
	user: 'User',
	assistant: 'Assistant',
	tool: 'Tool result',
};

function renderMessage(
	message: SharedMessage,
	resultFor: Map<SharedToolCall, SharedMessage>,
): string {
	const classes = message.displayOnly
		? `msg ${message.role} notice`
		: `msg ${message.role}`;
	const badge =
		message.outcome && message.outcome !== 'completed'
			? `<span class="badge">${escapeHtml(message.outcome)}</span>`
			: '';
	const name =
		message.role === 'tool' && message.name
			? `: ${escapeHtml(message.name)}`
			: '';
	const parts = [
		`<div class="role">${ROLE_LABELS[message.role]}${name}${badge}</div>`,
	];

	if (message.reasoning) {
		parts.push(
			`<details><summary>Reasoning</summary><div class="body"><div class="text">${escapeHtml(message.reasoning)}</div></div></details>`,
		);
	}
	if (message.role === 'tool') {
		parts.push(
			message.content === ''
				? '<p class="note">The tool returned no output.</p>'
				: `<pre>${escapeHtml(message.content)}</pre>`,
		);
	} else {
		parts.push(renderContent(message.content));
	}
	parts.push(renderImages(message));
	for (const call of message.toolCalls ?? []) {
		parts.push(renderToolCall(call, resultFor.get(call)));
	}

	return `<article class="${classes}">${parts.join('')}</article>`;
}

/**
 * Pair each tool result with the call it answers, walking in order so a call
 * id that a model reuses across turns still pairs with the right result.
 */
function pairToolResults(messages: readonly SharedMessage[]): {
	resultFor: Map<SharedToolCall, SharedMessage>;
	paired: Set<SharedMessage>;
} {
	const resultFor = new Map<SharedToolCall, SharedMessage>();
	const paired = new Set<SharedMessage>();
	const pending = new Map<string, SharedToolCall>();

	for (const message of messages) {
		for (const call of message.toolCalls ?? []) {
			pending.set(call.id, call);
		}
		if (message.role === 'tool' && message.toolCallId) {
			const call = pending.get(message.toolCallId);
			if (call) {
				resultFor.set(call, message);
				paired.add(message);
				pending.delete(message.toolCallId);
			}
		}
	}
	return {resultFor, paired};
}

function sessionTitle(messages: readonly SharedMessage[]): string {
	const firstLine = firstUserRequest(messages)
		?.content.split('\n')
		.map(line => line.trim())
		.find(Boolean);
	return firstLine ? truncateText(firstLine, 100) : '';
}

function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function renderShareHtml(payload: SharePayload): string {
	const {resultFor, paired} = pairToolResults(payload.messages);
	const title = sessionTitle(payload.messages);
	const prompts = payload.messages.filter(
		message => message.role === 'user' && !message.displayOnly,
	).length;
	const toolCalls = payload.messages.reduce(
		(sum, message) => sum + (message.toolCalls?.length ?? 0),
		0,
	);
	const meta = [
		escapeHtml(payload.provider),
		escapeHtml(payload.model),
		plural(prompts, 'prompt'),
		plural(toolCalls, 'tool call'),
		payload.redacted ? 'secrets redacted' : 'secrets NOT redacted',
	].join(' · ');

	const articles = payload.messages
		.filter(message => !paired.has(message))
		.map(message => renderMessage(message, resultFor));

	return [
		'<!doctype html>',
		'<html lang="en">',
		'<head>',
		'<meta charset="utf-8">',
		`<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
		'<meta name="referrer" content="no-referrer">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		'<meta name="generator" content="Nanocoder /share">',
		`<title>${title ? `${escapeHtml(title)} · ` : ''}Nanocoder session</title>`,
		`<style>${STYLE}</style>`,
		'</head>',
		'<body>',
		'<header>',
		'<h1>Nanocoder session</h1>',
		title ? `<p class="title">${escapeHtml(title)}</p>` : '',
		`<p class="meta">${meta}</p>`,
		'</header>',
		'<main>',
		...articles,
		'</main>',
		'<footer>Shared from Nanocoder with /share. This page is static: it runs no scripts and loads nothing from the network.</footer>',
		'</body>',
		'</html>',
	]
		.filter(line => line !== '')
		.join('\n')
		.concat('\n');
}
