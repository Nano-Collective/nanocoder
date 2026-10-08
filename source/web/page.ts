import {randomBytes} from 'node:crypto';

export const nanocoderLogoPngBuffer = Buffer.from(
	'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',
	'base64',
);

export function createPageNonce(): string {
	return randomBytes(16).toString('base64');
}

const IconSidebar = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="9" x2="9" y1="3" y2="21"/></svg>`;
const IconHistory = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
const IconSettings = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const IconSend = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" x2="11" y1="2" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
const IconUpload = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`;
const IconTrash = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;
const IconClose = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
const IconNewChat = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M14 3V5H4V18.3851L5.76282 17H20V10H22V18C22 18.5523 21.5523 19 21 19H6.45455L2 22.5V4C2 3.44772 2.44772 3 3 3H14ZM19 3V0H21V3H24V5H21V8H19V5H16V3H19Z"/></svg>`;
const IconSun = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`;
const IconMoon = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>`;

export function renderWebModePage(nonce: string = createPageNonce()): string {
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Nanocoder Web Mode</title>
	<link rel="icon" type="image/png" href="/assets/nanocoder-icon.png">
	<style nonce="${nonce}">
		:root {
			color-scheme: light dark;
			font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			background: var(--background);
			color: var(--foreground);
		}
		* {
			box-sizing: border-box;
			transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease;
		}
		html.theme-switching *,
		html.theme-switching *::before,
		html.theme-switching *::after {
			transition: none !important;
		}
		body {
			margin: 0;
			min-height: 100vh;
			background: var(--background);
			color: var(--foreground);
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
			background: var(--background);
			transition: grid-template-columns 200ms cubic-bezier(0.4, 0, 0.2, 1);
		}
		.app-shell.sidebar-collapsed {
			grid-template-columns: 60px minmax(0, 1fr);
		}
		.app-shell.sidebar-collapsed .sidebar {
			padding: 16px 8px 18px;
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 14px;
			border-right: 1px solid var(--border);
		}
		.app-shell.sidebar-collapsed .brand span,
		.app-shell.sidebar-collapsed #historyButton,
		.app-shell.sidebar-collapsed .thread-list,
		.app-shell.sidebar-collapsed .sidebar-footer {
			display: none;
		}
		.app-shell.sidebar-collapsed .brand-row {
			justify-content: center;
			width: 100%;
			display: contents;
		}
		.app-shell.sidebar-collapsed .brand-actions {
			flex-direction: column;
			width: 100%;
			display: contents;
		}
		.app-shell.sidebar-collapsed #settingsButton { order: 1; }
		.app-shell.sidebar-collapsed .new-chat { order: 2; }
		.app-shell.sidebar-collapsed #sidebarToggleButton { order: 3; }
		.app-shell.sidebar-collapsed .brand {
			display: none;
		}
		.app-shell.sidebar-collapsed #sidebarToggleButton {
			width: 36px;
			height: 36px;
			border-radius: 8px;
			background: transparent;
			border: 0;
			color: var(--muted-foreground);
			display: flex;
			align-items: center;
			justify-content: center;
		}
		.app-shell.sidebar-collapsed #sidebarToggleButton:hover {
			background: rgba(128, 128, 128, 0.08);
			color: var(--primary);
		}
		.app-shell.sidebar-collapsed .new-chat {
			width: 36px;
			height: 36px;
			min-width: 36px;
			padding: 0;
			border-radius: 8px;
			background: transparent;
			border: 0;
			color: var(--muted-foreground);
			display: flex;
			align-items: center;
			justify-content: center;
		}
		.app-shell.sidebar-collapsed .new-chat span {
			display: none;
		}
		.app-shell.sidebar-collapsed .new-chat svg {
			width: 18px;
			height: 18px;
		}
		.app-shell.sidebar-collapsed .new-chat:hover {
			background: rgba(128, 128, 128, 0.08);
			border-color: transparent;
			color: var(--primary);
			transform: none;
		}
		.sidebar {
			display: flex;
			flex-direction: column;
			gap: 14px;
			min-height: 100vh;
			height: 100vh;
			padding: 16px 14px 18px;
			border-right: 1px solid var(--border);
			background: var(--background);
			overflow: hidden;
			transition: opacity 150ms ease;
		}
		.brand-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
		}
		.brand-actions {
			display: flex;
			align-items: center;
			gap: 6px;
		}
		.brand {
			display: flex;
			align-items: center;
			gap: 10px;
			color: var(--foreground);
			font-size: 16px;
			font-weight: 700;
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
			background: transparent;
			color: var(--muted-foreground);
			cursor: pointer;
			transition: background 140ms ease, color 140ms ease, transform 140ms ease;
		}
		.icon-button:hover,
		.icon-button:focus-visible {
			background: rgba(128, 128, 128, 0.08);
			color: var(--primary);
			outline: 0;
		}
		.theme-toggle-btn {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 36px;
			height: 36px;
			border-radius: 8px;
			background: transparent;
			border: 0;
			color: var(--muted-foreground);
			cursor: pointer;
			padding: 8px;
			transition: color 200ms ease, background 200ms ease, transform 200ms ease;
		}
		.theme-toggle-btn:hover,
		.theme-toggle-btn:focus-visible {
			color: var(--foreground);
			background: rgba(128, 128, 128, 0.08);
			transform: scale(1.05);
			outline: 0;
		}
		.new-chat {
			display: flex;
			align-items: center;
			gap: 10px;
			height: 38px;
			padding: 0 12px;
			border: 1px solid var(--border);
			border-radius: 8px;
			background: var(--card);
			color: var(--foreground);
			font-size: 14px;
			font-weight: 500;
			cursor: pointer;
			transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease;
		}
		.new-chat:hover,
		.new-chat:focus-visible {
			background: rgba(128, 128, 128, 0.08);
			border-color: var(--primary);
			color: var(--primary);
			transform: translateY(-1px);
		}
		.thread-list {
			display: flex;
			flex-direction: column;
			flex: 1;
			gap: 4px;
			min-height: 0;
			overflow-y: auto;
			padding-top: 2px;
			scrollbar-width: none;
		}
		.thread-list::-webkit-scrollbar {
			display: none;
		}
		.thread-item {
			display: flex;
			align-items: center;
			justify-content: space-between;
			width: 100%;
			padding: 7px 10px;
			background: transparent;
			border: 0;
			color: var(--foreground);
			font-family: inherit;
			font-size: 15px;
			text-align: left;
			cursor: pointer;
			border-radius: 8px;
			transition: all 0.2s;
			white-space: nowrap;
			overflow: hidden;
			flex-shrink: 0;
		}
		.thread-item-text {
			flex: 1;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			text-align: left;
		}
		.thread-delete-btn {
			display: flex;
			align-items: center;
			justify-content: center;
			background: transparent;
			color: var(--muted-foreground);
			cursor: pointer;
			padding: 4px;
			border-radius: 4px;
			flex-shrink: 0;
			margin-left: 8px;
			opacity: 0;
			pointer-events: none;
			transition: opacity 0.2s;
			border: 0;
		}
		.thread-item:hover .thread-delete-btn {
			opacity: 1;
			pointer-events: auto;
		}
		.thread-delete-btn:hover {
			color: #ef4444;
		}
		.thread-item:hover,
		.thread-item:focus-visible {
			background: rgba(128, 128, 128, 0.12);
		}
		.thread-item.active {
			background: rgba(128, 128, 128, 0.12);
			color: var(--foreground);
			font-weight: 500;
		}
		.sidebar-footer {
			margin-top: auto;
			padding-top: 12px;
			border-top: 1px solid var(--border);
			display: flex;
			align-items: center;
			justify-content: space-between;
			color: var(--muted-foreground);
			font-size: 12px;
		}
		.thread-list-empty {
			margin: 0;
			padding: 6px 10px;
			color: var(--muted-foreground);
			font-size: 13px;
		}
		.workspace {
			position: relative;
			display: grid;
			grid-template-rows: auto minmax(0, 1fr) auto;
			min-width: 0;
			min-height: 100vh;
			background: var(--background);
		}
		.topbar {
			position: relative;
			display: flex;
			align-items: center;
			justify-content: space-between;
			min-height: 56px;
			padding: 0 22px;
		}
		.session-note {
			position: absolute;
			left: 50%;
			transform: translateX(-50%);
			margin: 0;
			color: var(--muted-foreground);
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
			gap: 6px;
			min-height: 24px;
			padding: 0 8px;
			border: 1px solid var(--border);
			border-radius: 12px;
			background: var(--card);
			color: var(--muted-foreground);
			font-size: 11px;
			font-weight: 600;
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
			color: var(--muted-foreground);
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
			gap: 10px;
			overflow-y: auto;
			padding: 28px 0 160px;
			scrollbar-width: none;
		}
		.messages::-webkit-scrollbar {
			display: none;
		}

		.message {
			display: grid;
			gap: 6px;
			pointer-events: auto;
			width: auto;
			margin-left: max(16px, calc(50% - 400px));
			margin-right: max(16px, calc(50% - 400px));
			padding: 14px 16px;
			border: 1px solid var(--border);
			border-radius: 8px;
			background: var(--card);
			color: var(--foreground);
			line-height: 1.5;
			overflow-wrap: anywhere;
			box-shadow: none;
		}
		.message:not(.assistant) .message-content {
			white-space: pre-wrap;
		}
		.message.user {
			align-self: flex-end;
			margin-left: auto;
			margin-right: max(16px, calc(50% - 400px));
			width: auto;
			max-width: min(600px, 85%);
			border-radius: 20px;
			padding: 10px 18px;
			background: rgba(128, 128, 128, 0.08);
			border: 1px solid var(--border);
			color: var(--foreground);
			box-shadow: none;
		}
		.message.assistant {
			padding: 2px 0 6px;
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
		.tok-keyword {
			color: var(--tn-primary);
		}
		.tok-string {
			color: var(--tn-success);
		}
		.tok-number {
			color: var(--tn-warning);
		}
		.tok-comment {
			color: var(--tn-secondary);
			font-style: italic;
		}
		.message.system {
			background: var(--muted);
			color: var(--muted-foreground);
		}
		.message.interaction {
			border-color: var(--primary);
			background: var(--card);
		}
		.interaction-card {
			display: grid;
			gap: 12px;
		}
		.interaction-card pre {
			margin: 0;
			overflow-x: auto;
			border: 1px solid var(--tn-border);
			border-radius: 8px;
			background: #12131c;
			padding: 12px 14px;
			font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
			font-size: 13px;
			white-space: pre-wrap;
		}
		.interaction-actions,
		.question-options {
			display: flex;
			flex-wrap: wrap;
			gap: 10px;
		}
		.interaction-actions button,
		.question-options button {
			min-height: 36px;
			padding: 0 14px;
			border: 1px solid rgba(125, 207, 255, 0.28);
			border-radius: 8px;
			background: rgba(125, 207, 255, 0.12);
			color: var(--foreground);
			cursor: pointer;
			font-size: 14px;
			font-weight: 650;
		}
		.interaction-actions button[data-approved="false"] {
			border-color: rgba(247, 118, 142, 0.35);
			background: rgba(247, 118, 142, 0.12);
		}
		.interaction-actions button:disabled,
		.question-options button:disabled,
		.question-freeform button:disabled {
			opacity: 0.55;
			cursor: default;
		}
		.question-freeform {
			display: grid;
			gap: 8px;
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.question-freeform input {
			min-height: 36px;
			padding: 0 12px;
			border: 1px solid var(--tn-border);
			border-radius: 8px;
			background: rgba(8, 9, 11, 0.35);
			color: var(--foreground);
		}
		.message.tool-status {
			border-style: dashed;
		}
		.empty-state {
			position: absolute;
			bottom: 100%;
			left: 50%;
			transform: translateX(-50%);
			width: min(760px, calc(100vw - 40px));
			margin-bottom: 16px;
			text-align: center;
			color: var(--foreground);
			opacity: 0;
			visibility: hidden;
			transition: all 0.4s ease;
		}
		.composer-wrap.is-empty .empty-state {
			opacity: 1;
			visibility: visible;
			transform: translateX(-50%) translateY(0);
		}
		.empty-state strong {
			display: block;
			margin-bottom: 8px;
			font-size: clamp(34px, 5vw, 48px);
			font-weight: 780;
			line-height: 1.05;
		}
		.empty-state span {
			color: var(--muted-foreground);
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
			border: 1px solid var(--border);
			border-radius: 999px;
			background: var(--card);
			color: var(--foreground);
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
			background: rgba(0, 0, 238, 0.1);
			border-color: var(--primary);
			color: var(--foreground);
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
			border: 1px solid var(--border);
			border-radius: 8px;
			background: var(--card);
			color: var(--foreground);
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
			background: rgba(0, 0, 238, 0.05);
			border-color: var(--primary);
			color: var(--foreground);
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
			color: var(--muted-foreground);
			font-size: 11px;
		}
		.composer-wrap {
			position: relative;
			z-index: 2;
			width: min(800px, calc(100% - 32px));
			margin: 0 auto 24px;
			transition: transform 0.6s cubic-bezier(0.2, 1, 0.2, 1);
		}
		.composer-wrap.is-empty {
			transform: translateY(-42vh);
		}
		.composer {
			display: grid;
			grid-template-columns: 1fr 36px;
			gap: 12px;
			align-items: end;
			min-height: 44px;
			border: 1px solid var(--border);
			border-radius: 22px;
			background: var(--card);
			padding: 4px 8px 4px 16px;
		}
		.composer.is-attention {
			border-color: var(--primary);
		}
		textarea {
			width: 100%;
			min-height: 24px;
			max-height: 180px;
			resize: none;
			border: 0;
			background: transparent;
			color: var(--foreground);
			font: inherit;
			line-height: 1.5;
			padding: 6px 2px;
		}
		textarea:focus {
			outline: 0;
		}
		textarea::placeholder {
			color: var(--muted-foreground);
		}
		.send-button {
			display: flex;
			align-items: center;
			justify-content: center;
			height: 36px;
			width: 36px;
			border-radius: 50%;
			border: 0;
			background: transparent;
			color: var(--primary);
			cursor: pointer;
			transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
		}
		.send-button:not(:disabled):hover,
		.send-button:not(:disabled):focus-visible {
			transform: translateY(-1px);
			background: var(--primary);
			color: var(--primary-foreground);
			outline: 0;
		}
		.send-button.is-cancel {
			background: #ff7675;
			color: #08090b;
		}
		.send-button.is-cancel:not(:disabled):hover,
		.send-button.is-cancel:not(:disabled):focus-visible {
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
			color: var(--muted-foreground);
			font-size: 12px;
			font-weight: 700;
		}
		.note {
			color: var(--muted-foreground);
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
				display: none;
			}
			.prompt-button {
				min-height: 48px;
			}
		}
				:root {
			color-scheme: light dark;
			font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			
			/* High Contrast Dark Theme */
			--background: #09090b;
			--foreground: #fafafa;
			--card: #18181b;
			--card-foreground: #fafafa;
			--primary: #fafafa;
			--primary-foreground: #18181b;
			--secondary: #005a9c;
			--secondary-foreground: #ffffff;
			--muted: #121214;
			--muted-foreground: #a1a1aa;
			--destructive: #7f1d1d;
			--destructive-foreground: #fafafa;
			--border: #27272a;
			
			/* Terminal Theme */
			--terminal-bg: #0b0f17;
			--terminal-border: #27272a;
			--terminal-text: #ffffff;
			--terminal-muted: #a1a1aa;

			/* Syntax highlighting */
			--tn-text: var(--foreground);
			--tn-primary: var(--primary);
			--tn-tool: var(--primary);
			--tn-success: #22c55e;
			--tn-error: #ef4444;
			--tn-secondary: var(--secondary);
			--tn-border: var(--border);
		}

		:root[data-theme="light"] {
			color-scheme: light;
			/* High Contrast Light Theme */
			--background: #ffffff;
			--foreground: #000000;
			--card: #ffffff;
			--card-foreground: #000000;
			--primary: #0000ee;
			--primary-foreground: #ffffff;
			--secondary: #005a9c;
			--secondary-foreground: #ffffff;
			--muted: #f9fafb;
			--muted-foreground: #6b7280;
			--destructive: #ef4444;
			--destructive-foreground: #ffffff;
			--border: #e5e7eb;
			
			/* Terminal Theme stays dark in light mode */
			--terminal-bg: #0b0f17;
			--terminal-border: #27272a;
			--terminal-text: #ffffff;
			--terminal-muted: #a1a1aa;
		}
		/*
		 * Light theme. Scoped with the [data-theme="light"] attribute selector
		 * Matches the organisation high-contrast white/blue theme.
		 */
		:root[data-theme="light"] {
			color-scheme: light;
		}
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		
		/* Modal Styles */
		.modal-overlay {
			position: fixed;
			top: 0; left: 0; right: 0; bottom: 0;
			background: rgba(0, 0, 0, 0.6);
			display: flex;
			align-items: center;
			justify-content: center;
			z-index: 1000;
		}
		.modal-overlay.hidden {
			display: none;
		}
		.modal-content {
			background: var(--background);
			border: 1px solid var(--border);
			border-radius: 8px;
			width: 100%;
			max-width: 500px;
			box-shadow: 0 4px 12px rgba(0,0,0,0.2);
			display: flex;
			flex-direction: column;
		}
		.modal-header {
			padding: 16px 20px;
			border-bottom: 1px solid var(--border);
			display: flex;
			justify-content: space-between;
			align-items: center;
		}
		.modal-header h2 {
			margin: 0;
			font-size: 1.1rem;
			font-weight: 600;
			color: var(--foreground);
		}
		.close-button {
			background: transparent;
			color: var(--muted-foreground);
			font-size: 1.5rem;
			padding: 0 4px;
			line-height: 1;
		}
		.close-button:hover {
			color: var(--foreground);
		}
		.modal-body {
			padding: 20px;
			color: var(--muted-foreground);
			font-size: 0.95rem;
		}
		.setting-group, .setting-group label {
			display: grid;
			gap: 8px;
		}
		.setting-group { gap: 16px; }
		.setting-group select, .setting-group button {
			font: inherit;
			padding: 10px;
			border: 1px solid var(--border);
			border-radius: 6px;
			background: var(--background);
			color: var(--foreground);
			min-width: 0;
			width: 100%;
		}
		.setting-group button:disabled { opacity: 0.5; cursor: default; }
		.custom-dropdown { position: relative; }
		.dropdown-trigger { display: flex; justify-content: space-between; gap: 12px; text-align: left; }
		.dropdown-trigger::after { content: '⌄'; }
		.dropdown-menu {
			position: absolute;
			top: calc(100% + 6px);
			left: 0;
			right: 0;
			max-height: 220px;
			overflow-y: auto;
			padding: 4px;
			background: var(--background);
			border: 1px solid var(--border);
			border-radius: 8px;
			box-shadow: 0 8px 24px rgba(0,0,0,0.18);
			z-index: 10;
		}
		.dropdown-menu[hidden] { display: none; }
		.setting-group .dropdown-option { border: 0; text-align: left; padding: 8px 10px; }
		.dropdown-option:hover, .dropdown-option:focus-visible, .dropdown-option[aria-selected="true"] { background: var(--muted); }
		.image-viewer { position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,0.8); display: grid; place-items: center; padding: 48px 24px; }
		.image-viewer[hidden] { display: none; }
		.image-viewer img { max-width: 100%; max-height: 85vh; object-fit: contain; }
		.image-viewer button {
			position: absolute;
			top: 16px;
			right: 20px;
			width: 40px;
			height: 40px;
			padding: 0;
			border-radius: 0;
			background: transparent;
			border: 0;
			color: white;
			display: grid;
			place-items: center;
			font-size: 24px;
			line-height: 1;
		}
		.image-viewer button:focus { outline: none; }
		.image-viewer button:focus-visible { outline: 2px solid white; outline-offset: 2px; }
		.work-summary { display: block; color: var(--muted-foreground); padding: 0; }
		.response-loader { padding: 4px 0; }
		.response-loader svg { width: 24px; height: 24px; animation: nc-pulse 2s ease-in-out infinite; }
		@keyframes nc-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
		@media (prefers-reduced-motion: reduce) { .response-loader svg { animation: none; } }
		.work-summary > summary { cursor: pointer; font-weight: 500; padding: 3px 0; }
		.work-body { display: grid; gap: 10px; padding-top: 8px; }
		.work-summary:not([open]) > .work-body { display: none; }
		.work-thought { white-space: pre-wrap; font-size: 13px; line-height: 1.6; }
		.work-tools { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
		.work-tool { padding: 10px 12px; border-bottom: 1px solid var(--border); }
		.work-tool:last-child { border-bottom: 0; }
		.work-tool-label { display: flex; gap: 8px; font-size: 13px; }
		.work-tool[data-status="failed"] .work-tool-label { color: #f7768e; }
		.work-tool[data-status="completed"] .work-tool-icon { color: #73daca; }
		.work-tool pre { max-height: 200px; overflow: auto; white-space: pre-wrap; font-size: 12px; margin: 8px 0 0; }
		.work-tool .interaction-card { margin-top: 10px; }
		.message-footer { display: flex; align-items: center; gap: 8px; margin-top: 4px; font-size: 11px; color: var(--muted-foreground); }
		.message.user { position: relative; margin-bottom: 16px; }
		.message.user .message-footer {
			position: absolute;
			top: 100%;
			right: 4px;
			margin-top: 4px;
			opacity: 0;
			pointer-events: none;
			white-space: nowrap;
		}
		.message.user:hover .message-footer { opacity: 1; }
		.message-footer button { display: grid; place-items: center; background: transparent; color: inherit; padding: 2px; border-radius: 4px; }
		.message-footer button:hover { color: var(--foreground); background: var(--muted); }
		.message-image, .composer-attachment img { cursor: zoom-in; }
		
		/* Image Upload Preview */
		.composer-preview {
			display: flex;
			gap: 8px;
			padding: 8px 12px 0;
			flex-wrap: wrap;
			grid-column: 1 / -1;
		}
		.composer-preview[hidden] { display: none; }
		.composer-attachment { position: relative; }
		.remove-attachment {
			position: absolute;
			top: -6px;
			right: -6px;
			width: 22px;
			height: 22px;
			border-radius: 50%;
			background: var(--foreground);
			color: var(--background);
			font-size: 16px;
			line-height: 1;
		}
		.composer-preview img {
			height: 48px;
			border-radius: 4px;
			border: 1px solid var(--border);
			object-fit: contain;
		}
		.message-images {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			margin-bottom: 8px;
		}
		.message-image {
			width: auto;
			height: auto;
			max-width: 160px;
			max-height: 112px;
			object-fit: contain;
			border-radius: 6px;
			display: block;
			border: 1px solid var(--border);
		}
		.composer-inputs {
			display: flex;
			gap: 8px;
			align-items: flex-end;
			flex: 1;
		}
		.upload-button {
			display: flex;
			align-items: center;
			justify-content: center;
			height: 36px;
			padding: 0 4px;
			color: var(--text-muted);
		}
		.upload-button:hover {
			color: var(--text);
		}
	</style>
</head>
<body>
	<div class="app-shell">
		<aside class="sidebar" aria-label="Nanocoder sessions">
			<div class="brand-row">
				<div class="brand">
					<span>Nanocoder</span>
				</div>
				<div class="brand-actions">
					<button class="icon-button" id="historyButton" type="button" aria-label="Refresh history">${IconHistory}</button>
					<button class="icon-button" id="settingsButton" type="button" aria-label="Settings">${IconSettings}</button>
					<button class="icon-button" id="sidebarToggleButton" type="button" aria-label="Collapse sidebar" aria-expanded="true">${IconSidebar}</button>
				</div>
			</div>
			<button class="new-chat" id="newChatButton" type="button">${IconNewChat}<span>New chat</span></button>
			<div class="thread-list" id="threadList" aria-live="polite">
				<p class="thread-list-empty" id="threadListEmpty">Loading sessions...</p>
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
				<button class="theme-toggle-btn" id="themeToggleButton" type="button" aria-label="Switch theme">${IconMoon}</button>
			</header>
			<section class="chat-stage" aria-label="Nanocoder browser chat">
				<div class="messages" id="messageList" aria-live="polite"></div>
			</section>
			<form class="composer-wrap" id="messageForm">
				<div class="empty-state" id="emptyState"></div>
				<div class="composer">
					<div class="composer-preview" id="imagePreviewContainer" hidden></div>
					<div class="composer-inputs">
						<input type="file" id="imageUploadInput" accept="image/*" multiple hidden>
						<button class="icon-button upload-button" id="uploadImageButton" type="button" aria-label="Upload image">${IconUpload}</button>
						<textarea id="messageInput" name="message" placeholder="Type your message here..." rows="1" disabled></textarea>
					</div>
					<button class="send-button" id="sendButton" type="submit" disabled aria-label="Send message">${IconSend}</button>
				</div>
				<div class="composer-meta">
					<div class="model-pill">Nanocoder local session</div>
					<p class="note" id="composerNote">Enter sends. Shift+Enter creates a new line.</p>
				</div>
			</form>
		</main>
	</div>

	<!-- Settings Modal -->
	<div id="settingsModal" class="modal-overlay hidden" aria-hidden="true">
		<div class="modal-content" role="dialog" aria-labelledby="modalTitle" aria-modal="true">
			<div class="modal-header">
				<h2 id="modalTitle">Settings</h2>
				<button type="button" class="close-button" id="closeSettingsButton" aria-label="Close settings">${IconClose}</button>
			</div>
			<div class="modal-body">
				<form id="settingsForm" class="setting-group">
					<div class="custom-dropdown"><span id="providerLabel">Provider</span><button type="button" class="dropdown-trigger" id="providerSelect" aria-labelledby="providerLabel" aria-haspopup="listbox" aria-expanded="false"></button><div class="dropdown-menu" id="providerOptions" role="listbox" hidden></div></div>
					<div class="custom-dropdown"><span id="modelLabel">Model</span><button type="button" class="dropdown-trigger" id="modelSelect" aria-labelledby="modelLabel" aria-haspopup="listbox" aria-expanded="false"></button><div class="dropdown-menu" id="modelOptions" role="listbox" hidden></div></div>
					<div class="custom-dropdown"><span id="modeLabel">Development mode</span><button type="button" class="dropdown-trigger" id="modeSelect" aria-labelledby="modeLabel" aria-haspopup="listbox" aria-expanded="false"></button><div class="dropdown-menu" id="modeOptions" role="listbox" hidden></div></div>
					<p id="settingsStatus">Waiting for the runtime.</p>
					<button type="submit" id="saveSettingsButton">Save settings</button>
				</form>
			</div>
		</div>
	</div>

	<div class="image-viewer" id="imageViewer" role="dialog" aria-modal="true" aria-label="Image preview" hidden><button type="button" id="closeImageViewer" aria-label="Close image preview">×</button><img id="expandedImage" alt="Expanded attachment"></div>
	<script nonce="${nonce}">
			const statusElement = document.querySelector('#connectionStatus');
			const messageList = document.querySelector('#messageList');
			const emptyState = document.querySelector('#emptyState');
			const messageForm = document.querySelector('#messageForm');
			const composerElement = document.querySelector('.composer');
			const messageInput = document.querySelector('#messageInput');
			const sendButton = document.querySelector('#sendButton');
			const newChatButton = document.querySelector('#newChatButton');
			const themeToggleButton = document.querySelector('#themeToggleButton');
			const sidebarToggleButton = document.querySelector('#sidebarToggleButton');
			const appShell = document.querySelector('.app-shell');
			const historyButton = document.querySelector('#historyButton');
			const settingsButton = document.querySelector('#settingsButton');
			const composerNote = document.querySelector('#composerNote');
			const threadList = document.querySelector('#threadList');
			
			const settingsModal = document.querySelector('#settingsModal');
			const closeSettingsButton = document.querySelector('#closeSettingsButton');
			const imageUploadInput = document.querySelector('#imageUploadInput');
			const uploadImageButton = document.querySelector('#uploadImageButton');
			const imagePreviewContainer = document.querySelector('#imagePreviewContainer');
			const settingsForm = document.querySelector('#settingsForm');
			const providerSelect = document.querySelector('#providerSelect');
			const modelSelect = document.querySelector('#modelSelect');
			const modeSelect = document.querySelector('#modeSelect');
			const settingsStatus = document.querySelector('#settingsStatus');
			const saveSettingsButton = document.querySelector('#saveSettingsButton');
			const imageViewer = document.querySelector('#imageViewer');
			const expandedImage = document.querySelector('#expandedImage');
			function imageSource(image) { return image.data.startsWith('data:') ? image.data : 'data:' + image.mediaType + ';base64,' + image.data; }
			function openImageViewer(src) { if (!src.startsWith('data:image/')) return; expandedImage.src = src; imageViewer.hidden = false; document.querySelector('#closeImageViewer').focus(); }
			function closeImageViewer() { imageViewer.hidden = true; expandedImage.src = ''; }
			document.querySelector('#closeImageViewer').addEventListener('click', closeImageViewer);
			imageViewer.addEventListener('click', event => { if (event.target === imageViewer) closeImageViewer(); });
			document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeImageViewer(); closeDropdowns(); } });
			let runtimeSettings = null;
			let runtimeReady = false;
			let runtimeStatus = 'Waiting for the runtime.';
			let settingsRequestId = null;
			let transientMessages = [];
			let pendingImages = [];
			const token = new URLSearchParams(window.location.search).get('token');
			const eventsUrl = new URL('/events', window.location.href);
			eventsUrl.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			eventsUrl.searchParams.set('token', token ?? '');
			const storageKey = 'nanocoder.webMode.localSession.v1';
			const pendingMessages = new Map();
			const pendingDrafts = new Map();
			const assistantMessages = new Map();
			let messageCounter = 0;
			let storedMessages = [];
			let activeTurnId = null;
			let sessionBusy = false;
			let sessionRevision = null;
			const pendingSessionActions = new Map();
			let isConnected = false;
			let socket = null;
			let reconnectTimer = null;
			let reconnectDelayMs = 1000;
			const maxReconnectDelayMs = 15000;
			const dirtyAssistantMessages = new Set();
			let renderTimer = null;
			let storageTimer = null;
			const threadElements = new Map();
			const messageElements = new Map();
			let previousNoticeSnapshot = '';
			const workSummaries = new Map();
			let responseLoader = null;
			function stopResponseLoader() { responseLoader?.remove(); responseLoader = null; }
			function showResponseLoader() {
				if (responseLoader) return;
				responseLoader = document.createElement('div');
				responseLoader.className = 'message assistant response-loader';
				responseLoader.setAttribute('role', 'status');
				responseLoader.setAttribute('aria-label', 'Nanocoder is responding');
				responseLoader.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M 2 5 H 5 V 8 H 7 V 12 H 9 V 5 H 12 V 19 H 9 V 16 H 7 V 12 H 5 V 19 H 2 Z"/><path d="M 14 5 H 22 V 8 H 17 V 16 H 22 V 19 H 14 Z"/></svg>';
				messageList.append(responseLoader);
				messageList.scrollTop = messageList.scrollHeight;
			}
			const toolCards = new Map();
			function ensureWorkSummary(id) {
				stopResponseLoader();
				let entry = workSummaries.get(id);
				if (entry) return entry;
				const element = document.createElement('details');
				element.className = 'message assistant work-summary';
				element.open = true;
				const header = document.createElement('summary');
				header.textContent = 'Thinking…';
				const body = document.createElement('div');
				body.className = 'work-body';
				element.append(header, body);
				messageList.append(element);
				entry = {element, header, body, thoughts: new Map(), tools: null, userToggled: false, status: 'working', startedAt: Date.now()};
				header.addEventListener('click', () => { entry.userToggled = true; });
				workSummaries.set(id, entry);
				return entry;
			}
			function updateWorkTool(turnId, tool) {
				const work = ensureWorkSummary(turnId);
				if (!work.tools) { work.tools = document.createElement('div'); work.tools.className = 'work-tools'; work.body.append(work.tools); }
				let card = toolCards.get(tool.id);
				if (!card) {
					const element = document.createElement('div'); element.className = 'work-tool';
					const label = document.createElement('div'); label.className = 'work-tool-label';
					const icon = document.createElement('span'); icon.className = 'work-tool-icon';
					const title = document.createElement('span');
					label.append(icon, title); element.append(label); work.tools.append(element);
					card = {element, icon, title, work, args: null, output: null}; toolCards.set(tool.id, card);
				}
				card.element.dataset.status = tool.status;
				card.icon.textContent = tool.status === 'completed' ? '✓' : tool.status === 'failed' ? '×' : tool.status === 'approval' ? '?' : '◌';
				const target = tool.arguments?.path ?? tool.arguments?.file_path ?? tool.arguments?.command ?? '';
				card.title.textContent = tool.name.replace(/_/g, ' ') + (target ? ' · ' + String(target).slice(0, 160) : '') + ' — ' + (tool.status === 'approval' ? 'Needs permission' : tool.status);
				if (tool.arguments && !card.args) { const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Arguments'; const pre = document.createElement('pre'); pre.textContent = formatToolArguments(tool.arguments); details.append(summary, pre); card.element.append(details); card.args = details; }
				if (tool.output && !card.output) { const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Result'; const pre = document.createElement('pre'); pre.textContent = tool.output; details.append(summary, pre); card.element.append(details); card.output = details; }
				work.header.textContent = work.status === 'working' ? 'Working…' : work.header.textContent;
				return card;
			}
			function renderWorkSummary(summary) {
				if (!summary.reasoning.length && !summary.tools.length) return;
				const work = ensureWorkSummary(summary.id);
				for (const thought of summary.reasoning) {
					let element = work.thoughts.get(thought.id);
					if (!element) { element = document.createElement('div'); element.className = 'work-thought'; work.body.append(element); work.thoughts.set(thought.id, element); }
					element.textContent = thought.text;
				}
				for (const tool of summary.tools) updateWorkTool(summary.id, tool);
				work.status = summary.status;
				work.startedAt = summary.startedAt;
				const seconds = Math.max(1, Math.round((Date.now() - summary.startedAt) / 1000));
				work.header.textContent = summary.status === 'working' ? (summary.tools.length ? 'Working…' : 'Thinking…') : (summary.status === 'failed' ? 'Work failed' : 'Worked') + ' · ' + seconds + 's' + (summary.tools.length ? ' · ' + summary.tools.length + ' tools' : '');
				if (summary.status !== 'working' && !work.userToggled) work.element.open = false;
			}
			function readPreference(key) {
				try { return window.localStorage.getItem(key); } catch { return null; }
			}
			function writePreference(key, value) {
				try { window.localStorage.setItem(key, value); } catch {}
			}

			// Initial load animation


			// Custom helper to animate elements in
			function animateIn(element) {
				if (element.animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
					element.animate([{opacity: 0, transform: 'translateY(15px)'}, {opacity: 1, transform: 'translateY(0)'}], {duration: 250, easing: 'ease-out'});
				}
			}


			const themeStorageKey = 'nanocoder.webMode.theme.v1';
			const sidebarStorageKey = 'nanocoder.webMode.sidebarCollapsed.v1';

			function applyTheme(theme) {
				document.documentElement.classList.add('theme-switching');
				document.documentElement.dataset.theme = theme;
				const isLight = theme === 'light';
				if (themeToggleButton) {
					themeToggleButton.innerHTML = isLight ? '${IconMoon}' : '${IconSun}';
					themeToggleButton.setAttribute('aria-pressed', String(isLight));
					themeToggleButton.setAttribute(
						'aria-label',
						isLight ? 'Switch to dark theme' : 'Switch to light theme',
					);
				}
				writePreference(themeStorageKey, theme);
				// Commit the new colors with transitions disabled before restoring
				// normal hover and layout animations.
				void document.documentElement.offsetHeight;
				document.documentElement.classList.remove('theme-switching');
			}

			function initialTheme() {
				const stored = readPreference(themeStorageKey);
				if (stored === 'light' || stored === 'dark') {
					return stored;
				}
				return 'light'; // Default to light mode (Organisation theme)
			}

			function applySidebarCollapsed(isCollapsed) {
				appShell.classList.toggle('sidebar-collapsed', isCollapsed);
				
				if (sidebarToggleButton) sidebarToggleButton.setAttribute('aria-expanded', String(!isCollapsed));
				if (sidebarToggleButton) sidebarToggleButton.setAttribute(
					'aria-label',
					isCollapsed ? 'Expand sidebar' : 'Collapse sidebar',
				);
				writePreference(sidebarStorageKey, String(isCollapsed));
			}

			function setStatus(text, state) {
				statusElement.textContent = text;
				statusElement.className = 'status' + (state ? ' ' + state : '');
			}

			function setComposerEnabled(isEnabled) {
				isConnected = isEnabled;
				updateComposer();
			}
			function fillSelect(select, values, selected) {
				select.value = selected;
				select.textContent = selected;
				const menu = dropdownMenus.get(select);
				menu.replaceChildren();
				for (const value of values) {
					const option = document.createElement('button');
					option.type = 'button';
					option.className = 'dropdown-option';
					option.setAttribute('role', 'option');
					option.setAttribute('aria-selected', String(value === selected));
					option.value = value;
					option.textContent = value;
					option.addEventListener('click', () => { fillSelect(select, values, value); closeDropdowns(); select.dispatchEvent(new Event('change')); select.focus(); });
					menu.append(option);
				}
			}
			const dropdownMenus = new Map([[providerSelect, document.querySelector('#providerOptions')], [modelSelect, document.querySelector('#modelOptions')], [modeSelect, document.querySelector('#modeOptions')]]);
			function closeDropdowns() { for (const [trigger, menu] of dropdownMenus) { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); } }
			for (const [trigger, menu] of dropdownMenus) {
				menu.hidden = true;
				trigger.addEventListener('click', () => { const open = menu.hidden; closeDropdowns(); menu.hidden = !open; trigger.setAttribute('aria-expanded', String(open)); });
				trigger.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); closeDropdowns(); menu.hidden = false; trigger.setAttribute('aria-expanded', 'true'); menu.querySelector('button')?.focus(); } });
				menu.addEventListener('keydown', event => {
					if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
					event.preventDefault();
					const options = [...menu.querySelectorAll('button')];
					const index = options.indexOf(document.activeElement);
					options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
				});
			}
			document.addEventListener('click', event => { if (!event.target.closest('.custom-dropdown')) closeDropdowns(); });
			function applyRuntimeSettings(settings) {
				if (JSON.stringify(settings) === JSON.stringify(runtimeSettings)) return;
				runtimeSettings = settings;
				fillSelect(providerSelect, settings.providers.map(provider => provider.name), settings.provider);
				fillSelect(modelSelect, settings.providers.find(provider => provider.name === settings.provider)?.models ?? [], settings.model);
				fillSelect(modeSelect, settings.modes, settings.mode);
				settingsStatus.textContent = 'Changes apply to this local session.';
			}

			function updateComposer() {
				if (!messageInput.value) messageInput.style.height = 'auto';
				messageInput.disabled = !isConnected || !runtimeReady || sessionBusy || activeTurnId !== null;
				sendButton.disabled = !isConnected || !runtimeReady || sessionBusy || (activeTurnId === null && messageInput.value.trim().length === 0 && pendingImages.length === 0);
				newChatButton.disabled = !isConnected || !runtimeReady || sessionBusy || activeTurnId !== null;
				uploadImageButton.disabled = !isConnected || !runtimeReady || sessionBusy || activeTurnId !== null;
				saveSettingsButton.disabled = !isConnected || !runtimeReady || sessionBusy || activeTurnId !== null || !runtimeSettings || settingsRequestId !== null;
				for (const select of [providerSelect, modelSelect, modeSelect]) select.disabled = saveSettingsButton.disabled;
			}

			function setActiveTurn(id) {
				activeTurnId = id;
				const isActive = id !== null;
				sendButton.classList.toggle('is-cancel', isActive);
				sendButton.textContent = isActive ? '■' : '↑';
				sendButton.setAttribute(
					'aria-label',
					isActive ? 'Cancel response' : 'Send message',
				);
				composerNote.textContent = isActive
					? 'Nanocoder is working. Use the stop button to cancel.'
					: runtimeReady ? 'Enter sends. Shift+Enter creates a new line.' : runtimeStatus;
				updateComposer();
				if (!id) stopResponseLoader();
				else if (!assistantMessages.has(id) && !workSummaries.has(id)) showResponseLoader();
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
				try {
					window.localStorage.setItem(storageKey, JSON.stringify(storedMessages));
				} catch {
					// Browser storage is optional; a full quota must not stop chat.
				}
			}
			function scheduleStorageWrite() {
				if (storageTimer !== null) return;
				storageTimer = window.setTimeout(() => { storageTimer = null; writeStoredMessages(); }, 500);
			}
			function flushAssistantRendering() {
				if (renderTimer !== null) window.clearTimeout(renderTimer);
				renderTimer = null;
				for (const id of dirtyAssistantMessages) {
					const element = assistantMessages.get(id)?.querySelector('.message-content');
					if (element) renderAssistantText(element, element.dataset.rawText ?? '');
				}
				dirtyAssistantMessages.clear();
				messageList.scrollTop = messageList.scrollHeight;
			}

			function setEmptyState(title, detail) {
				emptyState.innerHTML = '';
				const titleElement = document.createElement('strong');
				titleElement.textContent = title;
				emptyState.append(titleElement);

				if (detail) {
					const detailElement = document.createElement('span');
					detailElement.textContent = detail;
					emptyState.append(detailElement);
				}
				messageForm.classList.add('is-empty');
			}

			function hideEmptyState() {
				messageForm.classList.remove('is-empty');
			}

			const inlineCodeMarker = String.fromCharCode(96);

			function findNextMarkerIndex(text) {
				const boldIndex = text.indexOf('**');
				const strikeIndex = text.indexOf('~~');
				const codeIndex = text.indexOf(inlineCodeMarker);
				const linkIndex = text.indexOf('[');
				const italicIndex = text.indexOf('*');
				const candidates = [boldIndex, strikeIndex, codeIndex, linkIndex, italicIndex].filter(
					index => index >= 0,
				);
				return candidates.length === 0 ? -1 : Math.min(...candidates);
			}

			function appendInlineMarkdown(element, text) {
				let remainingText = text;

				while (remainingText) {
					const linkMatch = /^\\[([^\\]]+)\\]\\(([^)\\s]+)\\)/.exec(remainingText);
					if (linkMatch) {
						const anchor = document.createElement('a');
						anchor.href = linkMatch[2];
						anchor.target = '_blank';
						anchor.rel = 'noopener noreferrer';
						appendInlineMarkdown(anchor, linkMatch[1]);
						element.append(anchor);
						remainingText = remainingText.slice(linkMatch[0].length);
						continue;
					}

					const isBold = remainingText.startsWith('**');
					const isStrike = !isBold && remainingText.startsWith('~~');
					const isCode = !isBold && !isStrike && remainingText.startsWith(inlineCodeMarker);
					const isItalic = !isBold && !isStrike && !isCode && remainingText.startsWith('*');

					if (isBold || isStrike || isCode || isItalic) {
						const marker = isBold ? '**' : isStrike ? '~~' : isCode ? inlineCodeMarker : '*';
						const closingIndex = remainingText.indexOf(marker, marker.length);
						if (closingIndex >= 0) {
							const tagName = isBold ? 'strong' : isStrike ? 's' : isCode ? 'code' : 'em';
							const innerText = remainingText.slice(marker.length, closingIndex);
							const inlineElement = document.createElement(tagName);
							if (tagName === 'code') {
								inlineElement.textContent = innerText;
							} else {
								appendInlineMarkdown(inlineElement, innerText);
							}
							element.append(inlineElement);
							remainingText = remainingText.slice(closingIndex + marker.length);
							continue;
						}
					}

					const nextIndex = findNextMarkerIndex(remainingText.slice(1));
					if (nextIndex < 0) {
						element.append(document.createTextNode(remainingText));
						return;
					}
					element.append(document.createTextNode(remainingText.slice(0, nextIndex + 1)));
					remainingText = remainingText.slice(nextIndex + 1);
				}
			}

			const CODE_TOKEN_PATTERN = /(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*|#[^\\n]*)|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*')|(\\b\\d+(?:\\.\\d+)?\\b)|(\\b(?:function|return|const|let|var|if|else|for|while|class|import|export|from|async|await|new|try|catch|finally|throw|switch|case|break|continue|default|typeof|instanceof|extends|super|this|null|undefined|true|false|def|elif|except|as|with|lambda|yield|pass|None|True|False|self|fn|impl|struct|enum|match|pub|mut|use|type|interface|implements|public|private|protected|static|void|int|bool)\\b)/gu;

			function highlightCode(codeElement, rawText, language) {
				codeElement.replaceChildren();
				codeElement.className = language ? 'language-' + language : '';
				let lastIndex = 0;
				for (const match of rawText.matchAll(CODE_TOKEN_PATTERN)) {
					if (match.index > lastIndex) {
						codeElement.append(document.createTextNode(rawText.slice(lastIndex, match.index)));
					}
					const tokenType = match[1] ? 'comment' : match[2] ? 'string' : match[3] ? 'number' : 'keyword';
					const span = document.createElement('span');
					span.className = 'tok-' + tokenType;
					span.textContent = match[0];
					codeElement.append(span);
					lastIndex = match.index + match[0].length;
				}
				if (lastIndex < rawText.length) {
					codeElement.append(document.createTextNode(rawText.slice(lastIndex)));
				}
			}

			function renderAssistantText(element, text) {
				element.replaceChildren();
				const codeFence = inlineCodeMarker.repeat(3);
				let codeElement = null;
				let codeRawText = '';
				let codeLang = '';
				let listElement = null;

				for (const line of text.split('\\n')) {
					if (line.trim().startsWith(codeFence)) {
						if (codeElement) {
							highlightCode(codeElement, codeRawText, codeLang);
							codeElement = null;
							codeRawText = '';
							codeLang = '';
						} else {
							const preElement = document.createElement('pre');
							codeElement = document.createElement('code');
							codeLang = line.trim().slice(codeFence.length).trim();
							codeRawText = '';
							preElement.append(codeElement);
							element.append(preElement);
						}
						listElement = null;
						continue;
					}

					if (codeElement) {
						codeRawText += (codeRawText ? '\\n' : '') + line;
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
				if (codeElement) highlightCode(codeElement, codeRawText, codeLang);
			}

			function appendMessage(role, text, metaText, shouldStore = true, images = [], id, shouldAnimate = true) {
				if (shouldStore && role.startsWith('system')) transientMessages.push({role, text, metaText});
				hideEmptyState();
				const messageElement = document.createElement('div');
				messageElement.className = 'message ' + role;
				if (id) messageElement.dataset.messageId = id;

				if (images && images.length > 0) {
					const imageContainer = document.createElement('div');
					imageContainer.className = 'message-images';
					for (const img of images) {
						const imgEl = document.createElement('img');
						imgEl.className = 'message-image';
						imgEl.src = imageSource(img);
						imgEl.addEventListener('click', () => openImageViewer(imgEl.src));
						imageContainer.append(imgEl);
					}
					messageElement.append(imageContainer);
				}

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
				if (role === 'user' || role === 'assistant') {
					const footer = document.createElement('div'); footer.className = 'message-footer';
					const copy = document.createElement('button'); copy.type = 'button'; copy.title = 'Copy message'; copy.setAttribute('aria-label', 'Copy message');
					copy.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4"/></svg>';
					copy.addEventListener('click', async () => {
						try { await navigator.clipboard.writeText(role === 'assistant' ? textElement.dataset.rawText ?? '' : textElement.textContent); copy.title = 'Copied'; }
						catch { copy.title = 'Unable to copy'; }
					});
					const time = document.createElement('time'); time.className = 'message-time';
					if (role === 'assistant') footer.append(copy);
					footer.append(time); messageElement.append(footer);
					setMessageTime(messageElement, new Date().toISOString());
				}

				if (metaText) {
					const metaElement = document.createElement('div');
					metaElement.className = 'meta';
					metaElement.textContent = metaText;
					messageElement.append(metaElement);
				}

				messageList.append(messageElement);
				messageList.scrollTop = messageList.scrollHeight;

				if (shouldAnimate) animateIn(messageElement);
				if (id) messageElements.set(role + ':' + id, messageElement);

				if (shouldStore) {
					storedMessages.push({id, role, text, metaText: metaText ?? '', images});
					writeStoredMessages();
				}

				return messageElement;
			}
			function setMessageTime(element, createdAt) {
				const time = element.querySelector('.message-time');
				if (!time || !createdAt) return;
				const date = new Date(createdAt);
				if (Number.isNaN(date.getTime())) return;
				time.dateTime = createdAt;
				time.title = date.toLocaleString();
				time.textContent = date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
			}

			function updateMessageMeta(messageElement, metaText) {
				const stored = storedMessages.find(message => message.id === messageElement.dataset.messageId);
				if (stored) {
					stored.metaText = metaText;
					writeStoredMessages();
				}
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
					const element = appendMessage(message.role, message.text, message.metaText, false, message.images ?? [], message.id);
					if (message.role === 'assistant' && message.id) assistantMessages.set(message.id, element);
				}
			}

			function clearLocalSession() {
				storedMessages = [];
				try { window.localStorage.removeItem(storageKey); } catch {}
				pendingMessages.clear();
				assistantMessages.clear();
				messageList.replaceChildren();
				setEmptyState('How can I help you?', '');
				messageInput.value = '';
				messageInput.focus();
				activeSessionId = null;
				pendingImages = [];
				renderImagePreviews();
				renderThreadList(currentSessions);
			}

			let activeSessionId = null;
			let currentSessions = [];

			function formatRelativeTime(isoString) {
				const then = new Date(isoString).getTime();
				if (Number.isNaN(then)) {
					return '';
				}
				const diffMinutes = Math.floor((Date.now() - then) / 60000);
				if (diffMinutes < 1) {
					return 'just now';
				}
				if (diffMinutes < 60) {
					return diffMinutes + 'm ago';
				}
				const diffHours = Math.floor(diffMinutes / 60);
				if (diffHours < 24) {
					return diffHours + 'h ago';
				}
				const diffDays = Math.floor(diffHours / 24);
				if (diffDays < 30) {
					return diffDays + 'd ago';
				}
				return new Date(isoString).toLocaleDateString();
			}

			function renderThreadList(sessions) {
				currentSessions = sessions;
				const ids = new Set(sessions.map(session => session.id));
				for (const [id, entry] of threadElements) {
					if (!ids.has(id)) { entry.item.remove(); if (entry.timer) window.clearTimeout(entry.timer); threadElements.delete(id); }
				}

				if (sessions.length === 0) {
					threadList.replaceChildren();
					const empty = document.createElement('p');
					empty.className = 'thread-list-empty';
					empty.textContent = 'No saved sessions yet.';
					threadList.append(empty);
					return;
				}

				for (const session of sessions) {
					let entry = threadElements.get(session.id);
					if (entry) {
						entry.item.classList.toggle('active', session.id === activeSessionId);
						entry.time.textContent = formatRelativeTime(session.lastAccessedAt);
						if (entry.title !== session.title) animateThreadTitle(entry, session.title);
						threadList.append(entry.item);
						continue;
					}
					if (threadElements.size === 0) threadList.replaceChildren();
					const item = document.createElement('button');
					item.className = 'thread-item' + (session.id === activeSessionId ? ' active' : '');
					item.type = 'button';
					item.dataset.sessionId = session.id;
					item.dataset.threadLabel = session.title;
					
					const textSpan = document.createElement('span');
					textSpan.className = 'thread-item-text';
					const titleSpan = document.createElement('span');
					titleSpan.textContent = session.title;
					const timeSpan = document.createElement('span');
					timeSpan.className = 'thread-time';
					timeSpan.textContent = formatRelativeTime(session.lastAccessedAt);
					textSpan.append(titleSpan, document.createTextNode(' · '), timeSpan);
					entry = {item, titleSpan, time: timeSpan, title: session.title, timer: null};
					threadElements.set(session.id, entry);
					
					const deleteBtn = document.createElement('div');
					deleteBtn.className = 'thread-delete-btn';
					deleteBtn.title = 'Delete session';
					deleteBtn.innerHTML = '${IconTrash}';
					
					deleteBtn.addEventListener('click', (event) => {
						event.stopPropagation();
						if (activeTurnId) {
							addSystemNotice('Cannot delete a session while a turn is active.', 'Session switch');
							return;
						}
						
						sendClientEvent({
							type: 'delete_session',
							id: 'browser-delete-' + Date.now(),
							sessionId: session.id,
						});
						
					});

					item.append(textSpan, deleteBtn);
					threadList.append(item);
				}
			}
			function animateThreadTitle(entry, title) {
				entry.title = title;
				entry.item.dataset.threadLabel = title;
				if (entry.timer) window.clearTimeout(entry.timer);
				if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { entry.titleSpan.textContent = title; return; }
				let index = 0;
				const type = () => {
					entry.titleSpan.textContent = title.slice(0, ++index);
					entry.timer = index < title.length ? window.setTimeout(type, 35) : null;
				};
				type();
			}

			function applyLoadedSession(sessionSummary, messages) {
				activeSessionId = sessionSummary.id;
				storedMessages = [];
				pendingMessages.clear();
				assistantMessages.clear();
				messageList.replaceChildren();
				pendingImages = [];
				renderImagePreviews();

				if (messages.length === 0) {
					setEmptyState('How can I help you?', '');
				} else {
					hideEmptyState();
					for (const message of messages) {
						const element = appendMessage(message.role, message.content, '', true, message.images ?? [], message.id);
						if (message.role === 'assistant' && message.id) assistantMessages.set(message.id, element);
					}
				}

				messageInput.value = '';
				renderThreadList(currentSessions);
			}

			function setPromptText(text) {
				messageInput.value = text;
				adjustMessageInputHeight();
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

			function appendAssistantDelta(id, text, replace = false) {
				stopResponseLoader();
				let messageElement = assistantMessages.get(id);
				if (!messageElement) {
					messageElement = appendMessage('assistant', '', '', true, [], id, false);
					assistantMessages.set(id, messageElement);
				}

				const textElement = messageElement.querySelector('.message-content');
				const nextText = replace ? text : (textElement.dataset.rawText ?? '') + text;
				textElement.dataset.rawText = nextText;
				dirtyAssistantMessages.add(id);
				if (renderTimer === null) renderTimer = window.setTimeout(flushAssistantRendering, 16);
				const stored = storedMessages.find(message => message.id === id && message.role === 'assistant');
				if (stored) stored.text = nextText;
				scheduleStorageWrite();
			}

			function sendClientEvent(event) {
				if (!socket || socket.readyState !== WebSocket.OPEN) {
					appendMessage('system error', 'The local session is not connected.');
					return false;
				}

				socket.send(JSON.stringify(event));
				return true;
			}

			function formatToolArguments(args) {
				try {
					return JSON.stringify(args ?? {}, null, 2);
				} catch {
					return '{}';
				}
			}

			function disableInteractionCard(card) {
				for (const control of card.querySelectorAll('button, input')) {
					control.disabled = true;
				}
			}

			function renderApprovalCard(message) {
				if (messageList.querySelector('[data-interaction-id="' + message.id + '"]')) return;
				hideEmptyState();
				const messageElement = document.createElement('div');
				messageElement.className = 'message system interaction';
				const tool = message.toolCallId && activeTurnId ? updateWorkTool(activeTurnId, {id: message.toolCallId, name: message.toolName, status: 'approval', arguments: message.arguments}) : null;
				if (tool) { messageElement.className = 'interaction'; tool.work.element.open = true; }
				const card = document.createElement('div');
				card.className = 'interaction-card';
				card.dataset.interactionId = message.id;

				const title = document.createElement('strong');
				title.textContent = 'Approve tool: ' + message.toolName;
				card.append(title);

				if (message.context) {
					const context = document.createElement('div');
					context.className = 'meta';
					context.textContent = message.context;
					card.append(context);
				}

				const args = document.createElement('pre');
				args.textContent = formatToolArguments(message.arguments);
				card.append(args);

				const actions = document.createElement('div');
				actions.className = 'interaction-actions';
				const approveButton = document.createElement('button');
				approveButton.type = 'button';
				approveButton.dataset.approved = 'true';
				approveButton.textContent = 'Approve';
				const denyButton = document.createElement('button');
				denyButton.type = 'button';
				denyButton.dataset.approved = 'false';
				denyButton.textContent = 'Deny';
				actions.append(approveButton, denyButton);
				card.append(actions);
				messageElement.append(card);
				if (tool) tool.element.append(messageElement); else messageList.append(messageElement);
				messageList.scrollTop = messageList.scrollHeight;

				const respond = (approved) => {
					if (!sendClientEvent({type: 'approval_response', id: message.id, approved})) return;
					disableInteractionCard(card);
					if (tool) { tool.element.dataset.status = approved ? 'running' : 'failed'; tool.title.textContent = message.toolName.replace(/_/g, ' ') + (approved ? ' — Approved' : ' — Denied'); }
					const meta = document.createElement('div');
					meta.className = 'meta';
					meta.textContent = approved ? 'Approved' : 'Denied';
					messageElement.append(meta);
				};

				approveButton.addEventListener('click', () => respond(true));
				denyButton.addEventListener('click', () => respond(false));
			}

			function renderQuestionCard(message) {
				if (messageList.querySelector('[data-interaction-id="' + message.id + '"]')) return;
				hideEmptyState();
				const messageElement = document.createElement('div');
				messageElement.className = 'message system interaction';
				const card = document.createElement('div');
				card.className = 'interaction-card';
				card.dataset.interactionId = message.id;

				const title = document.createElement('strong');
				title.textContent = message.question;
				card.append(title);

				const options = document.createElement('div');
				options.className = 'question-options';
				for (const option of message.options || []) {
					const optionButton = document.createElement('button');
					optionButton.type = 'button';
					optionButton.textContent = option;
					optionButton.addEventListener('click', () => {
						disableInteractionCard(card);
						const meta = document.createElement('div');
						meta.className = 'meta';
						meta.textContent = 'Answered';
						messageElement.append(meta);
						sendClientEvent({
							type: 'question_response',
							id: message.id,
							answer: option,
						});
					});
					options.append(optionButton);
				}
				card.append(options);

				if (message.allowFreeform) {
					const freeform = document.createElement('div');
					freeform.className = 'question-freeform';
					const input = document.createElement('input');
					input.type = 'text';
					input.placeholder = 'Type a custom answer';
					input.autocomplete = 'off';
					const answerButton = document.createElement('button');
					answerButton.type = 'button';
					answerButton.textContent = 'Send answer';
					const submitFreeform = () => {
						const answer = input.value.trim();
						if (!answer) {
							return;
						}
						disableInteractionCard(card);
						const meta = document.createElement('div');
						meta.className = 'meta';
						meta.textContent = 'Answered';
						messageElement.append(meta);
						sendClientEvent({
							type: 'question_response',
							id: message.id,
							answer,
						});
					};
					answerButton.addEventListener('click', submitFreeform);
					input.addEventListener('keydown', event => {
						if (event.key === 'Enter') {
							event.preventDefault();
							submitFreeform();
						}
					});
					freeform.append(input, answerButton);
					card.append(freeform);
				}

				messageElement.append(card);
				messageList.append(messageElement);
				messageList.scrollTop = messageList.scrollHeight;
			}

			function handleServerEvent(message) {
				if (message.type === 'state') {
					flushAssistantRendering();
					const previousSession = activeSessionId;
					const sessionChanged = sessionRevision !== null && sessionRevision !== message.sessionRevision;
					sessionRevision = message.sessionRevision;
					const wasReady = runtimeReady;
					runtimeReady = message.runtimeReady ?? true;
					runtimeStatus = message.runtimeStatus ?? 'Ready';
					if (message.settings) applyRuntimeSettings(message.settings);
					if (isConnected) setStatus(runtimeReady ? 'Connected' : runtimeStatus, runtimeReady ? 'connected' : '');
					activeSessionId = message.session?.id ?? null;
					if (message.session) {
						const existing = currentSessions.find(session => session.id === message.session.id);
						if (!existing) currentSessions = [message.session, ...currentSessions];
						else Object.assign(existing, message.session);
					}
					sessionBusy = message.busy;
					if (sessionChanged) { stopResponseLoader(); messageList.replaceChildren(); messageElements.clear(); assistantMessages.clear(); workSummaries.clear(); toolCards.clear(); }
					const keep = new Set();
					storedMessages = [];
					for (const item of message.messages) {
						const key = item.role + ':' + item.id;
						keep.add(key);
						let element = messageElements.get(key);
						if (!element) element = appendMessage(item.role, item.content, '', false, item.images ?? [], item.id, false);
						else {
							const content = element.querySelector('.message-content');
							if (item.role === 'assistant' && content.dataset.rawText !== item.content) { content.dataset.rawText = item.content; renderAssistantText(content, item.content); }
							else if (item.role !== 'assistant') content.textContent = item.content;
						}
						storedMessages.push({id: item.id, role: item.role, text: item.content, images: item.images ?? []});
						setMessageTime(element, item.createdAt);
						if (item.role === 'assistant' && item.id) assistantMessages.set(item.id, element);
					}
					for (const [key, element] of messageElements) {
						if (!keep.has(key)) { element.remove(); messageElements.delete(key); }
					}
					if (message.notices) transientMessages = message.notices;
					else if (sessionChanged || previousSession !== activeSessionId) transientMessages = [];
					const noticeSnapshot = JSON.stringify(transientMessages);
					if (sessionChanged || noticeSnapshot !== previousNoticeSnapshot) {
						for (const node of messageList.querySelectorAll('.system')) { if (!node.classList.contains('interaction')) node.remove(); }
						for (const notice of transientMessages) appendMessage(notice.role, notice.text, notice.metaText, false, [], undefined, false);
						previousNoticeSnapshot = noticeSnapshot;
					}
					writeStoredMessages();
					if (message.messages.length === 0) setEmptyState('How can I help you?', '');
					if (sessionChanged || previousSession !== activeSessionId) {
						pendingImages = [];
						messageInput.value = '';
						renderImagePreviews();
					}
					setActiveTurn(message.activeTurnId);
					for (const summary of message.work ?? []) renderWorkSummary(summary);
					if (isConnected && !wasReady && runtimeReady) sendClientEvent({type: 'list_sessions', id: 'browser-sessions-' + Date.now()});
					renderThreadList(currentSessions);
					return;
				}
				if (message.type === 'interaction_closed') {
					const card = document.querySelector('[data-interaction-id="' + message.id + '"]');
					if (card) disableInteractionCard(card);
					return;
				}
				if (message.type === 'ready') {
					setStatus(runtimeReady ? 'Connected' : runtimeStatus, runtimeReady ? 'connected' : '');
					setComposerEnabled(true);
					if (storedMessages.length === 0) {
						setEmptyState('How can I help you?', '');
					}
					messageInput.focus();
					if (runtimeReady) sendClientEvent({type: 'list_sessions', id: 'browser-sessions-' + Date.now()});
					return;
				}

				if (message.type === 'ack') {
					if (message.id === settingsRequestId) {
						settingsRequestId = null;
						settingsStatus.textContent = 'Settings saved.';
						settingsModal.classList.add('hidden');
						settingsModal.setAttribute('aria-hidden', 'true');
						closeDropdowns();
						messageInput.focus();
						updateComposer();
					}
					pendingDrafts.delete(message.id);
					const action = pendingSessionActions.get(message.id);
					if (action) {
						pendingSessionActions.delete(message.id);
						pendingImages = [];
						messageInput.value = '';
						renderImagePreviews();
					}
					const messageElement = pendingMessages.get(message.id);
					if (messageElement) {
						messageElement.querySelector('.meta')?.remove();
						pendingMessages.delete(message.id);
					}
					return;
				}

				if (message.type === 'assistant_delta') {
					appendAssistantDelta(message.id, message.text);
					return;
				}
				if (message.type === 'assistant_content') {
					appendAssistantDelta(message.id, message.text, true);
					return;
				}
				if (message.type === 'work_update') { renderWorkSummary(message.work); return; }

				if (message.type === 'tool_started') {
					updateWorkTool(activeTurnId ?? 'current', {id: message.id, name: message.name, status: 'running', arguments: message.arguments});
					return;
				}

				if (message.type === 'tool_finished') {
					updateWorkTool(activeTurnId ?? 'current', {id: message.id, name: message.name, status: message.ok ? 'completed' : 'failed', output: message.output});
					return;
				}

				if (message.type === 'approval_required') {
					renderApprovalCard(message);
					return;
				}

				if (message.type === 'question_required') {
					renderQuestionCard(message);
					return;
				}

				if (message.type === 'turn_completed') {
					const work = workSummaries.get(message.id);
					const reply = assistantMessages.get(message.id);
					if (reply && work && !reply.querySelector('.message-duration')) {
						const duration = document.createElement('span'); duration.className = 'message-duration';
						duration.textContent = Math.max(1, Math.round((Date.now() - work.startedAt) / 1000)) + 's';
						reply.querySelector('.message-footer')?.append(duration);
					}
					if (work) { work.status = 'completed'; work.header.textContent = 'Worked · ' + Math.max(1, Math.round((Date.now() - work.startedAt) / 1000)) + 's'; if (!work.userToggled) work.element.open = false; }
					flushAssistantRendering();
					writeStoredMessages();
					if (message.id === activeTurnId) {
						setActiveTurn(null);
						messageInput.focus();
					}
					return;
				}

				if (message.type === 'error') {
					flushAssistantRendering();
					if (message.id === settingsRequestId) {
						settingsRequestId = null;
						settingsStatus.textContent = message.message;
						updateComposer();
					}
					if (message.id === activeTurnId) setActiveTurn(null);
					pendingSessionActions.delete(message.id);
					const draft = pendingDrafts.get(message.id);
					if (draft) {
						setPromptText(draft.text);
						pendingImages = draft.images;
						pendingDrafts.delete(message.id);
						renderImagePreviews();
					}
					const pendingMessageElement = message.id
						? pendingMessages.get(message.id)
						: undefined;
					if (pendingMessageElement) {
						const failedText =
							pendingMessageElement.querySelector('.message-content').textContent;
						updateMessageMeta(pendingMessageElement, 'Not sent — ' + message.message);
						pendingMessages.delete(message.id);
						setPromptText(failedText);
						pendingImages = storedMessages.find(item => item.id === message.id)?.images ?? [];
						renderImagePreviews();
					} else {
						appendMessage('system error', message.message);
					}
					return;
				}

				if (message.type === 'sessions') {
					renderThreadList(message.sessions);
					return;
				}
				if (message.type === 'notice') {
					addSystemNotice(message.message);
					return;
				}

				if (message.type === 'session_loaded') {
					// The following authoritative state event applies the transcript once.
					// Session metadata and selection arrive with that snapshot too.
					return;
				}

				appendMessage('system', 'Received an unsupported local session event.');
			}

			function submitUserMessage(text) {
				if (!isConnected || !runtimeReady || sessionBusy || activeTurnId) {
					return;
				}

				const trimmedText = text.trim();
				if (!trimmedText && pendingImages.length === 0) {
					return;
				}

				const id = 'browser-message-' + Date.now() + '-' + messageCounter++;
				const messageElement = appendMessage('user', trimmedText, 'Sending...', true, pendingImages, id);
				pendingMessages.set(id, messageElement);
				pendingDrafts.set(id, {text: trimmedText, images: pendingImages});
				messageInput.value = '';
				setActiveTurn(id);

				if (!sendClientEvent({
					type: 'user_message', 
					id, 
					text: trimmedText, 
					images: pendingImages.length > 0 ? pendingImages : undefined
				})) {
					updateMessageMeta(messageElement, 'Not sent');
					pendingMessages.delete(id);
					setActiveTurn(null);
				}
				
				pendingImages = [];
				renderImagePreviews();
			}

			function renderImagePreviews() {
				imagePreviewContainer.innerHTML = '';
				if (pendingImages.length > 0) {
					imagePreviewContainer.hidden = false;
					for (const [index, img] of pendingImages.entries()) {
						const attachment = document.createElement('div');
						attachment.className = 'composer-attachment';
						const imgEl = document.createElement('img');
						imgEl.src = imageSource(img);
						imgEl.addEventListener('click', () => openImageViewer(imgEl.src));
						imgEl.alt = 'Attached image ' + (index + 1);
						const remove = document.createElement('button');
						remove.type = 'button';
						remove.className = 'remove-attachment';
						remove.textContent = '×';
						remove.setAttribute('aria-label', 'Remove attached image ' + (index + 1));
						remove.addEventListener('click', () => { pendingImages.splice(index, 1); renderImagePreviews(); });
						attachment.append(imgEl, remove);
						imagePreviewContainer.append(attachment);
					}
				} else {
					imagePreviewContainer.hidden = true;
				}
				updateComposer();
			}

			function handleFiles(files) {
				if (activeTurnId || sessionBusy || !isConnected) return;
				for (const file of files) {
					if (!file.type.startsWith('image/')) continue;
					const reader = new FileReader();
					reader.onload = e => {
						if (activeTurnId || sessionBusy || !isConnected) return;
						pendingImages.push({ data: e.target.result.split(',')[1], mediaType: file.type });
						renderImagePreviews();
					};
					reader.readAsDataURL(file);
				}
				imageUploadInput.value = '';
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

			function connectSocket() {
				socket = new WebSocket(eventsUrl);

				socket.addEventListener('open', () => {
					reconnectDelayMs = 1000;
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
					setComposerEnabled(false);
					setStatus('Reconnecting…', '');
					scheduleReconnect();
				});
				socket.addEventListener('error', () => {
					setActiveTurn(null);
					setComposerEnabled(false);
				});
			}

			function scheduleReconnect() {
				if (reconnectTimer !== null) {
					return;
				}
				reconnectTimer = window.setTimeout(() => {
					reconnectTimer = null;
					connectSocket();
				}, reconnectDelayMs);
				reconnectDelayMs = Math.min(reconnectDelayMs * 2, maxReconnectDelayMs);
			}

			applyTheme(initialTheme());
			applySidebarCollapsed(readPreference(sidebarStorageKey) === 'true');

			setEmptyState('How can I help you?', '');
			restoreStoredMessages();
			connectSocket();

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

			function adjustMessageInputHeight() {
				messageInput.style.height = 'auto';
				messageInput.style.height = Math.min(messageInput.scrollHeight, 180) + 'px';
			}

			messageInput.addEventListener('input', () => {
				adjustMessageInputHeight();
					updateComposer();
			});

			messageInput.addEventListener('keydown', event => {
				if (event.key === 'Enter' && !event.shiftKey) {
					event.preventDefault();
					messageForm.requestSubmit();
				}
			});
			
			uploadImageButton.addEventListener('click', () => imageUploadInput.click());
			imageUploadInput.addEventListener('change', event => handleFiles(event.target.files));
			
			messageInput.addEventListener('paste', event => {
				if (event.clipboardData && event.clipboardData.files.length > 0) {
					handleFiles(event.clipboardData.files);
				}
			});

			document.addEventListener('dragover', event => event.preventDefault());
			document.addEventListener('drop', event => {
				event.preventDefault();
				if (event.dataTransfer && event.dataTransfer.files) {
					handleFiles(event.dataTransfer.files);
				}
			});

			document.addEventListener('visibilitychange', () => {
				if (document.visibilityState === 'visible') {
					messageList.scrollTop = messageList.scrollHeight;
				}
			});

			newChatButton.addEventListener('click', () => {
				if (!isConnected || activeTurnId || sessionBusy) return;
				const id = 'browser-reset-' + Date.now();
				if (sendClientEvent({type: 'reset_session', id})) pendingSessionActions.set(id, 'reset');
			});

			themeToggleButton.addEventListener('click', () => {
				applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
			});

			if (sidebarToggleButton) sidebarToggleButton.addEventListener('click', () => {
				applySidebarCollapsed(!appShell.classList.contains('sidebar-collapsed'));
			});

			if (historyButton) historyButton.addEventListener('click', () => {
				if (appShell.classList.contains('sidebar-collapsed')) {
					applySidebarCollapsed(false);
				}
				sendClientEvent({
					type: 'list_sessions',
					id: 'browser-sessions-' + Date.now(),
				});
			});

			if (settingsButton) settingsButton.addEventListener('click', () => {
				settingsModal.classList.remove('hidden');
				settingsModal.setAttribute('aria-hidden', 'false');
			});
			providerSelect.addEventListener('change', () => {
				const models = runtimeSettings?.providers.find(provider => provider.name === providerSelect.value)?.models ?? [];
				fillSelect(modelSelect, models, models[0] ?? '');
			});
			settingsForm.addEventListener('submit', event => {
				event.preventDefault();
				if (!runtimeReady || sessionBusy || activeTurnId || settingsRequestId) return;
				settingsRequestId = 'browser-settings-' + Date.now();
				if (!sendClientEvent({type: 'update_settings', id: settingsRequestId, provider: providerSelect.value, model: modelSelect.value, mode: modeSelect.value})) settingsRequestId = null;
				updateComposer();
			});
			closeSettingsButton.addEventListener('click', () => {
				settingsModal.classList.add('hidden');
				settingsModal.setAttribute('aria-hidden', 'true');
			});
			settingsModal.addEventListener('click', event => {
				if (event.target === settingsModal) {
					settingsModal.classList.add('hidden');
					settingsModal.setAttribute('aria-hidden', 'true');
				}
			});

			threadList.addEventListener('click', event => {
				const target = event.target.closest('.thread-item');
				if (!target || !target.dataset.sessionId) {
					return;
				}
				if (target.dataset.sessionId === activeSessionId) {
					return;
				}
				if (activeTurnId) {
					addSystemNotice(
						'Finish or cancel the current turn before switching sessions.',
						'Session switch',
					);
					return;
				}
				sendClientEvent({
					type: 'load_session',
					id: 'browser-load-' + Date.now(),
					sessionId: target.dataset.sessionId,
				});
			});
		</script>
</body>
</html>`;
}
