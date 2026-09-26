import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import {InfoMessage, SuccessMessage} from '@/components/message-box';
import {generateKey} from '@/session/key-generator';
import type {Command, Message} from '@/types/index';

/**
 * A single message in the deterministic share payload. Keys are always
 * written in the same order so the serialized JSON is byte-stable for a
 * given conversation (useful for diffing / hosting / caching).
 */
interface SharedMessage {
	role: Message['role'];
	content: string;
	reasoning?: string;
	name?: string;
	toolCalls?: {name: string; arguments: Record<string, unknown>}[];
}

interface SharePayload {
	version: 1;
	generator: string;
	exportedAt: string;
	title: string;
	provider: string;
	model: string;
	totalTokens: number;
	messageCount: number;
	messages: SharedMessage[];
}

/** Derive a short human-readable title from the first user message. */
function deriveTitle(messages: Message[]): string {
	const firstUser = messages.find(m => m.role === 'user' && m.content.trim());
	if (!firstUser) return 'Nanocoder session';
	const oneLine = firstUser.content.replace(/\s+/g, ' ').trim();
	return oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine;
}

/**
 * Build a deterministic representation of the session. System messages are
 * omitted (they are prompt scaffolding, not part of the shared trajectory).
 */
function buildPayload(
	messages: Message[],
	metadata: {provider: string; model: string; tokens: number},
): SharePayload {
	const shared: SharedMessage[] = [];
	for (const message of messages) {
		if (message.role === 'system') continue;
		const entry: SharedMessage = {
			role: message.role,
			content: message.content ?? '',
		};
		if (message.reasoning) entry.reasoning = message.reasoning;
		if (message.name) entry.name = message.name;
		if (message.tool_calls && message.tool_calls.length > 0) {
			entry.toolCalls = message.tool_calls.map(tc => ({
				name: tc.function.name,
				arguments: tc.function.arguments,
			}));
		}
		shared.push(entry);
	}

	return {
		version: 1,
		generator: 'nanocoder',
		exportedAt: new Date().toISOString(),
		title: deriveTitle(messages),
		provider: metadata.provider,
		model: metadata.model,
		totalTokens: metadata.tokens,
		messageCount: shared.length,
		messages: shared,
	};
}

/** Escape a value for safe interpolation into an HTML text node. */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/**
 * Embed the payload as JSON inside a `type="application/json"` script tag.
 * `<` is escaped to its unicode form so a `</script>` sequence anywhere in
 * the conversation can never break out of the tag (JSON stays valid).
 */
function buildViewerHtml(payload: SharePayload): string {
	const json = JSON.stringify(payload, null, 2).replace(/</g, '\\u003c');
	const title = escapeHtml(payload.title);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · Nanocoder session</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
	margin: 0;
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
	background: #0d1017;
	color: #c0caf5;
	line-height: 1.55;
}
header {
	padding: 24px 20px;
	border-bottom: 1px solid #1f2430;
	background: #10131c;
	position: sticky;
	top: 0;
}
header h1 { margin: 0 0 6px; font-size: 18px; }
header .meta { font-size: 13px; color: #7a88b8; }
main { max-width: 860px; margin: 0 auto; padding: 24px 16px 80px; }
.msg { margin: 0 0 18px; border: 1px solid #1f2430; border-radius: 10px; overflow: hidden; }
.msg > .role {
	font-size: 12px; text-transform: uppercase; letter-spacing: .06em;
	padding: 8px 14px; font-weight: 600;
}
.msg .body { padding: 12px 14px; white-space: pre-wrap; word-break: break-word; }
.role-user > .role { background: #1a2436; color: #7aa2f7; }
.role-assistant > .role { background: #1a2a22; color: #9ece6a; }
.role-tool > .role { background: #2a2320; color: #e0af68; }
.reasoning {
	margin: 10px 14px 0; padding: 8px 12px; border-left: 3px solid #565f89;
	color: #9aa5ce; font-size: 13px; white-space: pre-wrap;
}
.tools { margin: 0 14px 12px; }
.tool-call {
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 12px; background: #141824; border: 1px solid #1f2430;
	border-radius: 6px; padding: 8px 10px; margin-top: 8px; white-space: pre-wrap;
}
.tool-call .name { color: #e0af68; font-weight: 600; }
footer { text-align: center; color: #4a5170; font-size: 12px; padding: 24px; }
a { color: #7aa2f7; }
</style>
</head>
<body>
<header>
	<h1 id="title"></h1>
	<div class="meta" id="meta"></div>
</header>
<main id="timeline"></main>
<footer>Generated locally by <a href="https://github.com/Nano-Collective/nanocoder">Nanocoder</a> — no data left your machine.</footer>
<script id="session" type="application/json">${json}</script>
<script>
(function () {
	var data = JSON.parse(document.getElementById('session').textContent);
	document.title = data.title + ' \\u00b7 Nanocoder session';
	document.getElementById('title').textContent = data.title;
	document.getElementById('meta').textContent =
		data.provider + ' / ' + data.model + ' \\u00b7 ' +
		data.messageCount + ' messages \\u00b7 ' +
		data.totalTokens + ' tokens \\u00b7 ' +
		new Date(data.exportedAt).toLocaleString();

	var timeline = document.getElementById('timeline');
	function el(tag, cls, text) {
		var node = document.createElement(tag);
		if (cls) node.className = cls;
		if (text != null) node.textContent = text;
		return node;
	}

	data.messages.forEach(function (m) {
		var wrap = el('article', 'msg role-' + m.role);
		wrap.appendChild(el('div', 'role', m.name ? m.role + ': ' + m.name : m.role));
		if (m.reasoning) wrap.appendChild(el('div', 'reasoning', m.reasoning));
		if (m.content) wrap.appendChild(el('div', 'body', m.content));
		if (m.toolCalls && m.toolCalls.length) {
			var tools = el('div', 'tools');
			m.toolCalls.forEach(function (tc) {
				var call = el('div', 'tool-call');
				call.appendChild(el('span', 'name', tc.name));
				call.appendChild(document.createTextNode(
					'(' + JSON.stringify(tc.arguments, null, 2) + ')'
				));
				tools.appendChild(call);
			});
			wrap.appendChild(tools);
		}
		timeline.appendChild(wrap);
	});
})();
</script>
</body>
</html>
`;
}

/** Open a file in the OS default application, ignoring failures. */
function openInBrowser(filePath: string): void {
	let command: string;
	let args: string[];
	if (process.platform === 'darwin') {
		command = 'open';
		args = [filePath];
	} else if (process.platform === 'win32') {
		command = 'cmd';
		args = ['/c', 'start', '', filePath];
	} else {
		command = 'xdg-open';
		args = [filePath];
	}
	try {
		const child = spawn(command, args, {detached: true, stdio: 'ignore'});
		child.on('error', () => {});
		child.unref();
	} catch {
		// Best-effort only; the file path is still reported to the user.
	}
}

function Shared({filepath, jsonOnly}: {filepath: string; jsonOnly: boolean}) {
	return (
		<SuccessMessage
			hideBox={true}
			marginTop={1}
			marginBottom={1}
			message={
				jsonOnly
					? `Session serialized to ${filepath}`
					: `Session shared → ${filepath}\nOpening in your browser...`
			}
		/>
	);
}

function Empty() {
	return (
		<InfoMessage
			hideBox={true}
			marginTop={1}
			marginBottom={1}
			message="Nothing to share yet — start a conversation first."
		/>
	);
}

export const shareCommand: Command = {
	name: 'share',
	description:
		'Share the current session as a self-contained HTML viewer (use --json for raw JSON, --no-open to skip the browser, or pass a path/filename)',
	handler: async (args, messages, {provider, model, tokens}) => {
		const hasContent = messages.some(m => m.role !== 'system' && m.content);
		if (!hasContent) {
			return React.createElement(Empty, {key: generateKey('share')});
		}

		const jsonOnly = args.includes('--json');
		const noOpen = args.includes('--no-open');
		const positional = args.find(a => !a.startsWith('--'));

		const payload = buildPayload(messages, {provider, model, tokens});
		const ext = jsonOnly ? 'json' : 'html';
		const defaultName = `nanocoder-session-${new Date()
			.toISOString()
			.replace(/[:.]/g, '-')}.${ext}`;

		const target = positional || defaultName;
		// A bare filename lands in a temp dir so it does not clutter the repo;
		// an explicit path (contains a separator) is honored as-is.
		const filepath =
			positional && (positional.includes(path.sep) || positional.includes('/'))
				? path.resolve(process.cwd(), target)
				: path.join(os.tmpdir(), target);

		const contents = jsonOnly
			? JSON.stringify(payload, null, 2)
			: buildViewerHtml(payload);

		await fs.writeFile(filepath, contents, 'utf8');

		if (!jsonOnly && !noOpen) {
			openInBrowser(filepath);
		}

		return React.createElement(Shared, {
			key: generateKey('share'),
			filepath,
			jsonOnly: jsonOnly || noOpen,
		});
	},
};
