export const nanocoderLogoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Nanocoder">
<rect width="64" height="64" rx="12" fill="#02191d"/>
<path fill="#bb9af7" d="M8 17h7v30H8zM26 17h7v30h-7zM15 22h6v8h-6zM20 28h7v8h-7zM24 35h6v8h-6z"/>
<rect x="39" y="17" width="7" height="30" fill="#7dcfff"/>
<rect x="46" y="17" width="11" height="7" fill="#7dcfff"/>
<rect x="46" y="40" width="11" height="7" fill="#7dcfff"/>
</svg>`;

export function renderWebModePage(): string {
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Nanocoder Web Mode</title>
	<style>
		:root {
			color-scheme: light dark;
			font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			background: #08090b;
			color: #f5f2eb;
		}
		* {
			box-sizing: border-box;
		}
		body {
			margin: 0;
			min-height: 100vh;
			background: #08090b;
			color: #f5f2eb;
			overflow: hidden;
		}
		button,
		textarea {
			font: inherit;
		}
		button {
			border: 0;
			cursor: pointer;
		}
		.app-shell {
			display: grid;
			grid-template-columns: 280px minmax(0, 1fr);
			min-height: 100vh;
			background:
				linear-gradient(90deg, #090b0d 0, #0d1114 280px, #11161a 280px, #151a1f 100%);
		}
		.sidebar {
			display: grid;
			grid-template-rows: auto auto auto minmax(0, 1fr) auto;
			gap: 14px;
			min-height: 100vh;
			padding: 16px 14px 18px;
			border-right: 1px solid rgba(245, 242, 235, 0.08);
			background: rgba(9, 12, 14, 0.96);
			overflow: hidden;
		}
		.brand-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
		}
		.brand {
			display: flex;
			align-items: center;
			gap: 10px;
			color: #f5f2eb;
			font-size: 16px;
			font-weight: 760;
			letter-spacing: 0;
		}
		.brand-mark {
			display: block;
			width: 34px;
			height: 34px;
			border-radius: 10px;
			object-fit: cover;
			box-shadow:
				0 0 0 1px rgba(192, 202, 245, 0.16),
				0 10px 26px rgba(0, 0, 0, 0.22);
		}
		.icon-button {
			display: grid;
			place-items: center;
			width: 32px;
			height: 32px;
			border-radius: 8px;
			background: rgba(245, 242, 235, 0.06);
			color: #d8d0df;
			transition: background 140ms ease, transform 140ms ease;
		}
		.icon-button:hover {
			background: rgba(245, 242, 235, 0.11);
			transform: translateY(-1px);
		}
		.new-chat {
			height: 40px;
			border: 1px solid rgba(85, 217, 141, 0.28);
			border-radius: 8px;
			background: rgba(50, 91, 70, 0.46);
			color: #d8f7e6;
			font-weight: 730;
			transition: background 140ms ease, transform 140ms ease;
		}
		.new-chat:hover {
			background: rgba(61, 111, 85, 0.62);
			transform: translateY(-1px);
		}
		.search-box {
			display: flex;
			align-items: center;
			gap: 10px;
			min-height: 36px;
			padding: 0 10px;
			border: 1px solid transparent;
			border-radius: 8px;
			color: #9b92a4;
			font-size: 13px;
		}
		.search-box input {
			width: 100%;
			border: 0;
			background: transparent;
			color: #d9dee2;
			font: inherit;
			outline: 0;
		}
		.search-box input::placeholder {
			color: #8e969d;
		}
		.thread-list {
			display: grid;
			align-content: start;
			gap: 6px;
			min-height: 0;
			overflow-y: auto;
			padding-top: 2px;
		}
		.thread-item {
			display: flex;
			align-items: center;
			gap: 10px;
			min-height: 36px;
			width: 100%;
			padding: 0 10px;
			border: 0;
			border-radius: 8px;
			background: transparent;
			color: #afa8b8;
			font-size: 13px;
			text-align: left;
		}
		.thread-item.active {
			background: rgba(245, 242, 235, 0.08);
			color: #f5f2eb;
		}
		.thread-item:hover {
			background: rgba(245, 242, 235, 0.055);
			color: #f5f2eb;
		}
		.sidebar-footer {
			display: flex;
			align-items: center;
			justify-content: space-between;
			color: #9b92a4;
			font-size: 13px;
		}
		.workspace {
			position: relative;
			display: grid;
			grid-template-rows: auto minmax(0, 1fr) auto;
			min-width: 0;
			min-height: 100vh;
			background:
				radial-gradient(circle at 50% 18%, rgba(85, 217, 141, 0.055), transparent 30rem),
				linear-gradient(180deg, #171b20 0%, #14191d 46%, #101417 100%);
		}
		.topbar {
			display: flex;
			align-items: center;
			justify-content: space-between;
			min-height: 56px;
			padding: 0 22px;
		}
		.session-note {
			color: #8f8797;
			font-size: 13px;
			font-weight: 650;
		}
		.top-actions {
			display: flex;
			align-items: center;
			gap: 10px;
		}
		.status {
			display: inline-flex;
			align-items: center;
			gap: 8px;
			min-height: 32px;
			padding: 0 11px;
			border: 1px solid rgba(245, 242, 235, 0.1);
			border-radius: 8px;
			background: rgba(8, 9, 11, 0.42);
			color: #beb7c7;
			font-size: 13px;
			font-weight: 700;
		}
		.status::before {
			content: "";
			width: 8px;
			height: 8px;
			border-radius: 999px;
			background: #f5a524;
			box-shadow: 0 0 0 5px rgba(245, 165, 36, 0.12);
		}
		.status.connected {
			color: #b8f3d4;
		}
		.status.connected::before {
			background: #55d98d;
			box-shadow: 0 0 0 5px rgba(85, 217, 141, 0.14);
		}
		.status.disconnected,
		.status.failed {
			color: #ffc4c4;
		}
		.status.disconnected::before,
		.status.failed::before {
			background: #ff7675;
			box-shadow: 0 0 0 5px rgba(255, 118, 117, 0.14);
		}
		h1 {
			font-size: clamp(34px, 5vw, 46px);
			line-height: 1.1;
			letter-spacing: 0;
			margin: 0;
		}
		p {
			color: #b7afc1;
			font-size: 14px;
			line-height: 1.5;
			margin: 0;
		}
		.chat-stage {
			position: relative;
			min-height: 0;
		}
		.messages {
			position: absolute;
			inset: 0;
			z-index: 1;
			display: flex;
			flex-direction: column;
			gap: 16px;
			overflow-y: auto;
			pointer-events: none;
			padding: 28px clamp(18px, 10vw, 160px) 160px;
			scroll-behavior: smooth;
		}
		.message {
			display: grid;
			gap: 6px;
			pointer-events: auto;
			width: min(760px, 100%);
			padding: 14px 16px;
			border: 1px solid rgba(245, 242, 235, 0.08);
			border-radius: 8px;
			background: rgba(245, 242, 235, 0.055);
			color: #f5f2eb;
			line-height: 1.5;
			overflow-wrap: anywhere;
			box-shadow: 0 12px 40px rgba(0, 0, 0, 0.14);
		}
		.message:not(.assistant) .message-content {
			white-space: pre-wrap;
		}
		.message.user {
			align-self: flex-end;
			width: auto;
			max-width: min(680px, 85%);
			border-radius: 16px 16px 4px 16px;
			background: #f5f2eb;
			color: #17151d;
		}
		.message.assistant {
			align-self: flex-start;
			width: min(820px, 100%);
			padding: 4px 0 18px;
			border: 0;
			background: transparent;
			box-shadow: none;
		}
		.markdown {
			font-size: 15px;
			line-height: 1.7;
		}
		.markdown > :first-child {
			margin-top: 0;
		}
		.markdown > :last-child {
			margin-bottom: 0;
		}
		.markdown h1,
		.markdown h2,
		.markdown h3 {
			margin: 24px 0 10px;
			color: var(--tn-text);
			font-size: 18px;
			line-height: 1.35;
		}
		.markdown p,
		.markdown ul,
		.markdown ol,
		.markdown pre {
			margin: 0 0 14px;
		}
		.markdown p,
		.markdown li {
			color: inherit;
		}
		.markdown ul,
		.markdown ol {
			padding-left: 24px;
		}
		.markdown li + li {
			margin-top: 5px;
		}
		.markdown code {
			border-radius: 4px;
			background: rgba(125, 207, 255, 0.1);
			padding: 2px 5px;
			font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
			font-size: 0.9em;
		}
		.markdown pre {
			overflow-x: auto;
			border: 1px solid var(--tn-border);
			border-radius: 8px;
			background: #12131c;
			padding: 14px 16px;
		}
		.markdown pre code {
			background: transparent;
			padding: 0;
		}
		.message.system {
			align-self: center;
			width: min(760px, 100%);
			background: rgba(8, 9, 11, 0.26);
			color: #beb7c7;
		}
		.empty-state {
			position: absolute;
			z-index: 2;
			top: 40%;
			left: 50%;
			transform: translate(-50%, -50%);
			width: min(760px, calc(100vw - 40px));
			text-align: center;
			color: #f5f2eb;
		}
		.empty-state strong {
			display: block;
			margin-bottom: 22px;
			font-size: clamp(34px, 5vw, 48px);
			font-weight: 780;
			line-height: 1.05;
		}
		.empty-state span {
			color: #beb7c7;
			font-size: 15px;
			line-height: 1.6;
		}
		.mode-pills {
			display: flex;
			flex-wrap: wrap;
			justify-content: center;
			gap: 10px;
			margin: 0 auto 30px;
		}
		.mode-pill {
			display: inline-flex;
			align-items: center;
			gap: 8px;
			min-height: 38px;
			padding: 0 18px;
			border: 1px solid rgba(245, 242, 235, 0.08);
			border-radius: 999px;
			background: rgba(245, 242, 235, 0.045);
			color: #cfc7d8;
			cursor: pointer;
			font-size: 14px;
			font-weight: 720;
			transition:
				background 140ms ease,
				border-color 140ms ease,
				color 140ms ease,
				transform 140ms ease;
		}
		.mode-pill:hover,
		.mode-pill:focus-visible {
			background: rgba(125, 207, 255, 0.12);
			border-color: rgba(125, 207, 255, 0.32);
			color: #f5f2eb;
			outline: 0;
			transform: translateY(-1px);
		}
		.prompt-list {
			width: min(720px, 100%);
			margin: 0 auto;
			display: grid;
			gap: 10px;
			text-align: left;
		}
		.prompt-button {
			position: relative;
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 14px;
			width: 100%;
			min-height: 54px;
			padding: 0 16px;
			border: 1px solid rgba(245, 242, 235, 0.075);
			border-radius: 8px;
			background: rgba(245, 242, 235, 0.028);
			color: #c7bfce;
			cursor: pointer;
			text-align: left;
			font-size: 15px;
			transition:
				background 140ms ease,
				border-color 140ms ease,
				color 140ms ease,
				transform 140ms ease;
		}
		.prompt-button::after {
			content: "→";
			color: rgba(245, 242, 235, 0.42);
			font-size: 16px;
			transition: color 140ms ease, transform 140ms ease;
		}
		.prompt-button:hover,
		.prompt-button:focus-visible {
			background: rgba(245, 242, 235, 0.06);
			border-color: rgba(125, 207, 255, 0.28);
			color: #f5f2eb;
			outline: 0;
			transform: translateY(-1px);
		}
		.prompt-button:hover::after,
		.prompt-button:focus-visible::after {
			color: #7dcfff;
			transform: translateX(2px);
		}
		.message.error {
			border-color: rgba(255, 118, 117, 0.45);
			color: #ffc4c4;
		}
		.meta {
			color: rgba(245, 242, 235, 0.58);
			font-size: 12px;
		}
		.message.user .meta {
			color: rgba(17, 20, 24, 0.62);
		}
		.composer-wrap {
			position: relative;
			z-index: 2;
			width: min(820px, calc(100vw - 340px));
			margin: 0 auto 24px;
		}
		.composer {
			display: grid;
			grid-template-columns: 1fr 46px;
			gap: 12px;
			align-items: end;
			min-height: 104px;
			border: 1px solid rgba(245, 242, 235, 0.09);
			border-radius: 8px;
			background: rgba(29, 35, 40, 0.94);
			padding: 14px;
			box-shadow: 0 24px 80px rgba(0, 0, 0, 0.32);
		}
		.composer.is-attention {
			border-color: rgba(125, 207, 255, 0.56);
			box-shadow:
				0 0 0 3px rgba(125, 207, 255, 0.12),
				0 24px 80px rgba(0, 0, 0, 0.32);
		}
		textarea {
			width: 100%;
			min-height: 70px;
			max-height: 180px;
			resize: none;
			border: 0;
			background: transparent;
			color: #f5f2eb;
			font: inherit;
			line-height: 1.5;
			padding: 6px 2px;
		}
		textarea:focus {
			outline: 0;
		}
		textarea::placeholder {
			color: #928899;
		}
		.send-button {
			display: grid;
			place-items: center;
			width: 42px;
			height: 42px;
			border-radius: 8px;
			background: #55d98d;
			color: #0d1114;
			transition: transform 120ms ease, opacity 120ms ease;
		}
		.send-button:not(:disabled):hover {
			transform: translateY(-1px);
			background: #6ee7a1;
		}
		.send-button.is-cancel {
			background: #ff7675;
			color: #08090b;
		}
		.send-button.is-cancel:not(:disabled):hover {
			background: #ff9493;
		}
		.send-button:disabled,
		textarea:disabled {
			cursor: not-allowed;
			opacity: 0.55;
		}
		.composer-meta {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			margin-top: 10px;
			padding: 0 4px;
		}
		.model-pill {
			display: inline-flex;
			align-items: center;
			gap: 8px;
			color: #bdb4c7;
			font-size: 12px;
			font-weight: 700;
		}
		.note {
			color: #8f96a3;
			font-size: 12px;
		}
		@media (max-width: 900px) {
			body {
				overflow: auto;
			}
			.app-shell {
				grid-template-columns: 1fr;
			}
			.sidebar {
				display: none;
			}
			.workspace {
				min-height: 100vh;
			}
			.composer-wrap {
				width: min(720px, calc(100vw - 24px));
			}
			.messages {
				padding: 18px 14px 150px;
			}
			.topbar {
				padding: 0 14px;
			}
			.session-note {
				display: none;
			}
		}
		@media (max-width: 640px) {
			.composer {
				grid-template-columns: 1fr;
			}
			.send-button {
				width: 100%;
			}
			.empty-state {
				top: 40%;
				width: calc(100vw - 28px);
			}
			.prompt-button {
				min-height: 48px;
			}
		}
		/* Match Nanocoder's default Tokyo Night terminal theme. */
		:root {
			--tn-text: #c0caf5;
			--tn-base: #1a1b26;
			--tn-primary: #bb9af7;
			--tn-tool: #7dcfff;
			--tn-success: #7AF778;
			--tn-error: #f7768e;
			--tn-secondary: #565f89;
			--tn-info: #2ac3de;
			--tn-warning: #e0af68;
			--tn-panel: #16161f;
			--tn-surface: #24283b;
			--tn-border: rgba(192, 202, 245, 0.14);
		}
		body {
			background: var(--tn-base);
			color: var(--tn-text);
		}
		.app-shell {
			background:
				linear-gradient(90deg, #12131c 0, #12131c 280px, var(--tn-base) 280px, var(--tn-base) 100%);
		}
		.sidebar {
			border-right-color: var(--tn-border);
			background: #12131c;
		}
		.brand,
		.thread-item.active,
		.thread-item:hover,
		.prompt-button:hover,
		.empty-state,
		.message,
		textarea,
		.model-pill {
			color: var(--tn-text);
		}
		.brand-mark,
		.message.user {
			background: var(--tn-text);
			color: var(--tn-base);
		}
		.brand-mark {
			background: #16161f;
		}
		.icon-button {
			background: rgba(192, 202, 245, 0.08);
			color: var(--tn-text);
		}
		.icon-button:hover {
			background: rgba(125, 207, 255, 0.14);
		}
		.new-chat {
			border-color: rgba(187, 154, 247, 0.42);
			background: rgba(187, 154, 247, 0.14);
			color: var(--tn-primary);
		}
		.new-chat:hover {
			background: rgba(187, 154, 247, 0.24);
		}
		.search-box {
			border-color: rgba(192, 202, 245, 0.08);
			color: var(--tn-secondary);
		}
		.search-box:focus-within {
			border-color: rgba(125, 207, 255, 0.28);
			background: rgba(36, 40, 59, 0.45);
		}
		.search-box input {
			color: var(--tn-text);
		}
		.search-box input::placeholder,
		.thread-item,
		.sidebar-footer,
		.session-note,
		p,
		.empty-state span,
		.note {
			color: var(--tn-secondary);
		}
		.thread-item.active,
		.thread-item:hover,
		.mode-pill,
		.prompt-button:hover {
			background: rgba(125, 207, 255, 0.1);
		}
		.workspace {
			background:
				radial-gradient(circle at 50% 16%, rgba(187, 154, 247, 0.13), transparent 28rem),
				linear-gradient(180deg, #1a1b26 0%, #171823 52%, #12131c 100%);
		}
		.status {
			border-color: var(--tn-border);
			background: rgba(22, 22, 31, 0.78);
			color: var(--tn-text);
		}
		.status::before {
			background: var(--tn-warning);
			box-shadow: 0 0 0 5px rgba(224, 175, 104, 0.12);
		}
		.status.connected {
			color: var(--tn-success);
		}
		.status.connected::before {
			background: var(--tn-success);
			box-shadow: 0 0 0 5px rgba(122, 247, 120, 0.14);
		}
		.status.disconnected,
		.status.failed,
		.message.error {
			color: var(--tn-error);
		}
		.status.disconnected::before,
		.status.failed::before {
			background: var(--tn-error);
			box-shadow: 0 0 0 5px rgba(247, 118, 142, 0.14);
		}
		.message {
			border-color: var(--tn-border);
			background: rgba(36, 40, 59, 0.82);
		}
		.message.system,
		.mode-pill {
			background: rgba(36, 40, 59, 0.72);
		}
		.message.assistant {
			background: transparent;
		}
		.message.system {
			color: var(--tn-text);
		}
		.mode-pill {
			border-color: var(--tn-border);
		}
		.prompt-button {
			border-color: rgba(192, 202, 245, 0.12);
			background: rgba(36, 40, 59, 0.5);
			color: var(--tn-text);
		}
		.prompt-button::after {
			color: rgba(125, 207, 255, 0.54);
		}
		.message.error {
			border-color: rgba(247, 118, 142, 0.45);
		}
		.meta {
			color: rgba(192, 202, 245, 0.62);
		}
		.message.user .meta {
			color: rgba(26, 27, 38, 0.64);
		}
		.composer {
			border-color: rgba(125, 207, 255, 0.24);
			background: rgba(36, 40, 59, 0.98);
		}
		textarea::placeholder {
			color: var(--tn-secondary);
		}
		.send-button {
			background: var(--tn-tool);
			color: var(--tn-base);
		}
		.send-button:not(:disabled):hover {
			background: #9de1ff;
		}
	</style>
</head>
<body>
	<div class="app-shell">
		<aside class="sidebar" aria-label="Nanocoder sessions">
			<div class="brand-row">
				<div class="brand">
					<img class="brand-mark" src="/assets/nanocoder-icon.svg" alt="Nanocoder logo">
					<span>Nanocoder</span>
				</div>
				<button class="icon-button" id="sessionMenuButton" type="button" aria-label="Session menu">⌘</button>
			</div>
			<button class="new-chat" id="newChatButton" type="button">New Chat</button>
			<label class="search-box">
				<span>⌕</span>
				<input id="threadSearchInput" type="search" placeholder="Search local threads..." autocomplete="off">
			</label>
			<div class="thread-list">
				<button class="thread-item active" type="button" data-thread-label="Nanocoder web mode">● Nanocoder web mode</button>
				<button class="thread-item" type="button" data-thread-label="Runtime bridge next">○ Runtime bridge next</button>
				<button class="thread-item" type="button" data-thread-label="Tool approvals">○ Tool approvals</button>
			</div>
			<div class="sidebar-footer">
				<span>Local only</span>
				<span>Private token</span>
			</div>
		</aside>
		<main class="workspace">
			<header class="topbar">
				<div class="status" id="connectionStatus">Starting</div>
				<p class="session-note">Localhost only. Private URL token required.</p>
				<div class="top-actions">
					<button class="icon-button" id="historyButton" type="button" aria-label="Session history">◷</button>
					<button class="icon-button" id="settingsButton" type="button" aria-label="Session settings">☷</button>
				</div>
			</header>
			<section class="chat-stage" aria-label="Nanocoder browser chat">
				<div class="empty-state" id="emptyState"></div>
				<div class="messages" id="messageList" aria-live="polite"></div>
			</section>
			<form class="composer-wrap" id="messageForm">
				<div class="composer">
					<textarea id="messageInput" name="message" placeholder="Type your message here..." disabled></textarea>
					<button class="send-button" id="sendButton" type="submit" disabled aria-label="Send message">↑</button>
				</div>
				<div class="composer-meta">
					<div class="model-pill">Nanocoder local session</div>
					<p class="note" id="composerNote">Enter sends. Shift+Enter creates a new line.</p>
				</div>
			</form>
		</main>
	</div>
	<script>
		const statusElement = document.querySelector('#connectionStatus');
		const messageList = document.querySelector('#messageList');
			const emptyState = document.querySelector('#emptyState');
				const messageForm = document.querySelector('#messageForm');
				const composerElement = document.querySelector('.composer');
				const messageInput = document.querySelector('#messageInput');
			const sendButton = document.querySelector('#sendButton');
			const newChatButton = document.querySelector('#newChatButton');
			const sessionMenuButton = document.querySelector('#sessionMenuButton');
			const historyButton = document.querySelector('#historyButton');
			const settingsButton = document.querySelector('#settingsButton');
			const composerNote = document.querySelector('#composerNote');
			const threadSearchInput = document.querySelector('#threadSearchInput');
			const threadButtons = Array.from(document.querySelectorAll('.thread-item'));
			const token = new URLSearchParams(window.location.search).get('token');
			const eventsUrl = new URL('/events', window.location.href);
			eventsUrl.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			eventsUrl.searchParams.set('token', token ?? '');
			const storageKey = 'nanocoder.webMode.localSession.v1';
			const pendingMessages = new Map();
			const assistantMessages = new Map();
			const modePrompts = [
				['✦ Create', 'Draft a clean implementation plan for the next Nanocoder web mode step'],
				['▣ Explore', 'Explore this repository and summarize the web mode architecture'],
				['</> Code', 'Help me implement the next small, tested web mode change'],
				['◇ Learn', 'Teach me how this browser session connects to the local CLI runtime'],
			];
			const promptSuggestions = [
				'Summarize this repository and suggest the next clean change',
				'Find the safest place to wire browser chat into the CLI',
				'Review the current web mode implementation for edge cases',
				'Explain how this local session sends messages to Nanocoder',
			];
			let messageCounter = 0;
			let storedMessages = [];
			let activeTurnId = null;
			let isConnected = false;

		function setStatus(text, state) {
			statusElement.textContent = text;
			statusElement.className = 'status' + (state ? ' ' + state : '');
		}

			function setComposerEnabled(isEnabled) {
				isConnected = isEnabled;
				messageInput.disabled = !isEnabled || activeTurnId !== null;
				sendButton.disabled = !isEnabled;
			}

			function setActiveTurn(id) {
				activeTurnId = id;
				const isActive = id !== null;
				messageInput.disabled = !isConnected || isActive;
				sendButton.disabled = !isConnected;
				sendButton.classList.toggle('is-cancel', isActive);
				sendButton.textContent = isActive ? '■' : '↑';
				sendButton.setAttribute(
					'aria-label',
					isActive ? 'Cancel response' : 'Send message',
				);
				composerNote.textContent = isActive
					? 'Nanocoder is working. Use the stop button to cancel.'
					: 'Enter sends. Shift+Enter creates a new line.';
				newChatButton.disabled = isActive;
			}

			function readStoredMessages() {
				try {
					const storedValue = window.localStorage.getItem(storageKey);
					if (!storedValue) {
						return [];
					}

					const parsedValue = JSON.parse(storedValue);
					if (!Array.isArray(parsedValue)) {
						return [];
					}

					return parsedValue.filter(
						message =>
							message &&
							typeof message.role === 'string' &&
							typeof message.text === 'string',
					);
				} catch {
					return [];
				}
			}

			function writeStoredMessages() {
				window.localStorage.setItem(storageKey, JSON.stringify(storedMessages));
			}

		function setEmptyState(title, detail, includePrompts = false) {
			emptyState.innerHTML = '';
			const titleElement = document.createElement('strong');
			titleElement.textContent = title;
			emptyState.append(titleElement);

			if (includePrompts) {
				const modePills = document.createElement('div');
				modePills.className = 'mode-pills';
				for (const [label, prompt] of modePrompts) {
					const pill = document.createElement('button');
					pill.className = 'mode-pill';
					pill.type = 'button';
					pill.textContent = label;
					pill.dataset.action = 'fill';
					pill.dataset.prompt = prompt;
					modePills.append(pill);
				}
				emptyState.append(modePills);

				const promptList = document.createElement('div');
				promptList.className = 'prompt-list';
				for (const prompt of promptSuggestions) {
					const promptButton = document.createElement('button');
					promptButton.className = 'prompt-button';
					promptButton.type = 'button';
					promptButton.textContent = prompt;
					promptButton.dataset.action = 'submit';
					promptButton.dataset.prompt = prompt;
					promptList.append(promptButton);
				}
				emptyState.append(promptList);
				emptyState.hidden = false;
				return;
			}

			const detailElement = document.createElement('span');
			detailElement.textContent = detail;
			emptyState.append(detailElement);
			emptyState.hidden = false;
		}

		function hideEmptyState() {
			emptyState.hidden = true;
		}

		function appendInlineMarkdown(element, text) {
			const inlineCodeMarker = String.fromCharCode(96);
			let remainingText = text;

			while (remainingText) {
				const strongIndex = remainingText.indexOf('**');
				const codeIndex = remainingText.indexOf(inlineCodeMarker);
				const markerIndexes = [strongIndex, codeIndex].filter(index => index >= 0);

				if (markerIndexes.length === 0) {
					element.append(document.createTextNode(remainingText));
					return;
				}

				const markerIndex = Math.min(...markerIndexes);
				if (markerIndex > 0) {
					element.append(document.createTextNode(remainingText.slice(0, markerIndex)));
					remainingText = remainingText.slice(markerIndex);
				}

				const marker = remainingText.startsWith('**') ? '**' : inlineCodeMarker;
				const closingIndex = remainingText.indexOf(marker, marker.length);
				if (closingIndex < 0) {
					element.append(document.createTextNode(remainingText));
					return;
				}

				const inlineElement = document.createElement(marker === '**' ? 'strong' : 'code');
				inlineElement.textContent = remainingText.slice(marker.length, closingIndex);
				element.append(inlineElement);
				remainingText = remainingText.slice(closingIndex + marker.length);
			}
		}

		function renderAssistantText(element, text) {
			element.replaceChildren();
			const codeFence = String.fromCharCode(96).repeat(3);
			let codeElement = null;
			let listElement = null;

			for (const line of text.split('\\n')) {
				if (line.trim().startsWith(codeFence)) {
					if (codeElement) {
						codeElement = null;
					} else {
						const preElement = document.createElement('pre');
						codeElement = document.createElement('code');
						preElement.append(codeElement);
						element.append(preElement);
					}
					listElement = null;
					continue;
				}

				if (codeElement) {
					codeElement.textContent += (codeElement.textContent ? '\\n' : '') + line;
					continue;
				}

				if (!line.trim()) {
					listElement = null;
					continue;
				}

				const headingMatch = /^(#{1,3})\\s+(.*)$/.exec(line);
				const unorderedMatch = /^[-*]\\s+(.*)$/.exec(line);
				const orderedMatch = /^\\d+\\.\\s+(.*)$/.exec(line);

				if (headingMatch) {
					const headingElement = document.createElement('h' + headingMatch[1].length);
					appendInlineMarkdown(headingElement, headingMatch[2]);
					element.append(headingElement);
					listElement = null;
					continue;
				}

				const listMatch = unorderedMatch ?? orderedMatch;
				if (listMatch) {
					const listTag = unorderedMatch ? 'UL' : 'OL';
					if (!listElement || listElement.tagName !== listTag) {
						listElement = document.createElement(listTag.toLowerCase());
						element.append(listElement);
					}
					const itemElement = document.createElement('li');
					appendInlineMarkdown(itemElement, listMatch[1]);
					listElement.append(itemElement);
					continue;
				}

				const paragraphElement = document.createElement('p');
				appendInlineMarkdown(paragraphElement, line);
				element.append(paragraphElement);
				listElement = null;
			}
		}

			function appendMessage(role, text, metaText, shouldStore = true) {
				hideEmptyState();
				const messageElement = document.createElement('div');
				messageElement.className = 'message ' + role;
				const textElement = document.createElement('div');
				textElement.className = 'message-content';
				if (role === 'assistant') {
					textElement.classList.add('markdown');
					textElement.dataset.rawText = text;
					renderAssistantText(textElement, text);
				} else {
					textElement.textContent = text;
				}
				messageElement.append(textElement);

			if (metaText) {
				const metaElement = document.createElement('div');
				metaElement.className = 'meta';
				metaElement.textContent = metaText;
				messageElement.append(metaElement);
			}

				messageList.append(messageElement);
				messageList.scrollTop = messageList.scrollHeight;

				if (shouldStore) {
					storedMessages.push({role, text, metaText: metaText ?? ''});
					writeStoredMessages();
				}

				return messageElement;
			}

		function updateMessageMeta(messageElement, metaText) {
			let metaElement = messageElement.querySelector('.meta');
			if (!metaElement) {
				metaElement = document.createElement('div');
				metaElement.className = 'meta';
				messageElement.append(metaElement);
			}
				metaElement.textContent = metaText;
			}

			function restoreStoredMessages() {
				storedMessages = readStoredMessages();
				if (storedMessages.length === 0) {
					return;
				}

				for (const message of storedMessages) {
					appendMessage(message.role, message.text, message.metaText, false);
				}
			}

			function clearLocalSession() {
				storedMessages = [];
				window.localStorage.removeItem(storageKey);
				pendingMessages.clear();
				assistantMessages.clear();
				messageList.replaceChildren();
				setEmptyState('How can I help you?', '', true);
				messageInput.value = '';
				messageInput.focus();
			}

				function setPromptText(text) {
					messageInput.value = text;
					composerElement.classList.add('is-attention');
					window.setTimeout(() => {
						composerElement.classList.remove('is-attention');
					}, 900);
					messageForm.scrollIntoView({block: 'center', behavior: 'smooth'});
					messageInput.focus();
				}

			function addSystemNotice(text, metaText = 'Local UI') {
				appendMessage('system', text, metaText);
			}

		function appendAssistantDelta(id, text) {
			let messageElement = assistantMessages.get(id);
			if (!messageElement) {
				messageElement = appendMessage('assistant', '');
				assistantMessages.set(id, messageElement);
			}

			const textElement = messageElement.firstElementChild;
			const nextText = (textElement.dataset.rawText ?? '') + text;
			textElement.dataset.rawText = nextText;
			renderAssistantText(textElement, nextText);
			messageList.scrollTop = messageList.scrollHeight;
		}

			function sendClientEvent(event) {
				if (socket.readyState !== WebSocket.OPEN) {
					appendMessage('system error', 'The local session is not connected.');
					return false;
				}

			socket.send(JSON.stringify(event));
			return true;
		}

		function handleServerEvent(message) {
			if (message.type === 'ready') {
				setStatus('Connected', 'connected');
				setComposerEnabled(true);
				if (storedMessages.length === 0) {
					setEmptyState('How can I help you?', '', true);
				}
				messageInput.focus();
				return;
			}

			if (message.type === 'ack') {
				const messageElement = pendingMessages.get(message.id);
				if (messageElement) {
					updateMessageMeta(messageElement, 'Delivered to local session');
					pendingMessages.delete(message.id);
				}
				return;
			}

			if (message.type === 'assistant_delta') {
				appendAssistantDelta(message.id, message.text);
				return;
			}

			if (message.type === 'tool_started') {
				appendMessage('system', 'Tool started: ' + message.name);
				return;
			}

			if (message.type === 'tool_finished') {
				appendMessage('system', 'Tool finished: ' + message.name, message.ok ? 'Completed' : 'Failed');
				return;
			}

			if (message.type === 'approval_required') {
				appendMessage('system', message.reason, 'Approval required');
				return;
			}

			if (message.type === 'question_required') {
				appendMessage('system', message.question, 'Question required');
				return;
			}

			if (message.type === 'turn_completed') {
				if (message.id === activeTurnId) {
					setActiveTurn(null);
					messageInput.focus();
				}
				return;
			}

			if (message.type === 'error') {
				setActiveTurn(null);
				appendMessage('system error', message.message);
				return;
			}

				appendMessage('system', 'Received an unsupported local session event.');
			}

			function submitUserMessage(text) {
				if (activeTurnId) {
					return;
				}

				const trimmedText = text.trim();
				if (!trimmedText) {
					return;
				}

				const id = 'browser-message-' + Date.now() + '-' + messageCounter++;
				const messageElement = appendMessage('user', trimmedText, 'Sending...');
				pendingMessages.set(id, messageElement);
				messageInput.value = '';
				setActiveTurn(id);

				if (!sendClientEvent({type: 'user_message', id, text: trimmedText})) {
					updateMessageMeta(messageElement, 'Not sent');
					pendingMessages.delete(id);
					setActiveTurn(null);
				}
			}

			emptyState.addEventListener('click', event => {
				const target = event.target.closest('[data-prompt]');
				if (!target) {
					return;
				}

				const prompt = target.dataset.prompt ?? '';
				if (target.dataset.action === 'submit') {
					submitUserMessage(prompt);
					return;
				}

				setPromptText(prompt);
			});

			const socket = new WebSocket(eventsUrl);
			setEmptyState('How can I help you?', '', true);
			restoreStoredMessages();
			socket.addEventListener('open', () => {
				setStatus('Connecting', '');
				sendClientEvent({type: 'hello', protocolVersion: 1});
		});
		socket.addEventListener('message', event => {
			try {
				const message = JSON.parse(event.data);
				handleServerEvent(message);
			} catch {
				appendMessage('system error', 'Received an invalid local session event.');
			}
		});
		socket.addEventListener('close', () => {
			setActiveTurn(null);
			setStatus('Disconnected', 'disconnected');
			setComposerEnabled(false);
			setEmptyState('Disconnected', 'Restart nanocoder --web to open a fresh local session.');
		});
		socket.addEventListener('error', () => {
			setActiveTurn(null);
			setStatus('Connection failed', 'failed');
			setComposerEnabled(false);
			setEmptyState('Connection failed', 'The browser could not reach the local Nanocoder server.');
		});

			messageForm.addEventListener('submit', event => {
				event.preventDefault();
				if (activeTurnId) {
					sendClientEvent({type: 'cancel', id: activeTurnId});
					sendButton.disabled = true;
					composerNote.textContent = 'Cancelling the active Nanocoder turn...';
					return;
				}

				submitUserMessage(messageInput.value);
			});

			messageInput.addEventListener('keydown', event => {
				if (event.key === 'Enter' && !event.shiftKey) {
					event.preventDefault();
					messageForm.requestSubmit();
				}
			});

			newChatButton.addEventListener('click', () => {
				clearLocalSession();
				addSystemNotice('Started a fresh local browser session.', 'Stored only in this browser');
			});

			sessionMenuButton.addEventListener('click', () => {
				addSystemNotice('This session is served from localhost and protected by the private URL token.', 'Session menu');
			});

			historyButton.addEventListener('click', () => {
				const count = storedMessages.length;
				addSystemNotice(
					count === 1
						? 'There is 1 stored local message in this browser.'
						: 'There are ' + count + ' stored local messages in this browser.',
					'Session history',
				);
			});

			settingsButton.addEventListener('click', () => {
				addSystemNotice('Provider, model, tools, and approvals are still owned by the terminal runtime in this phase.', 'Session settings');
			});

			threadSearchInput.addEventListener('input', () => {
				const query = threadSearchInput.value.trim().toLowerCase();
				for (const threadButton of threadButtons) {
					const label = threadButton.dataset.threadLabel.toLowerCase();
					threadButton.hidden = query.length > 0 && !label.includes(query);
				}
			});

			for (const threadButton of threadButtons) {
				threadButton.addEventListener('click', () => {
					for (const button of threadButtons) {
						button.classList.toggle('active', button === threadButton);
					}
					addSystemNotice(threadButton.dataset.threadLabel + ' selected.', 'Local thread');
				});
			}
		</script>
</body>
</html>`;
}
