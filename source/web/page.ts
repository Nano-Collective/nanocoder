import {randomBytes} from 'node:crypto';

export const nanocoderLogoPngBuffer = Buffer.from(
	'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',
	'base64',
);

export function createPageNonce(): string {
	return randomBytes(16).toString('base64');
}

export const IconSidebar = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="9" x2="9" y1="3" y2="21"/></svg>`;
export const IconHistory = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
export const IconSettings = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
export const IconSend = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" x2="11" y1="2" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
export const IconUpload = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`;
export const IconTrash = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;
export const IconClose = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
export const IconNewChat = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M14 3V5H4V18.3851L5.76282 17H20V10H22V18C22 18.5523 21.5523 19 21 19H6.45455L2 22.5V4C2 3.44772 2.44772 3 3 3H14ZM19 3V0H21V3H24V5H21V8H19V5H16V3H19Z"/></svg>`;
export const IconSun = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`;
export const IconMoon = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>`;
export const IconTheme = IconSun;
export const IconCreate = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;vertical-align:-2px"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>`;
export const IconExplore = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;vertical-align:-2px"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`;
export const IconCode = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;vertical-align:-2px"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
export const IconLearn = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;vertical-align:-2px"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>`;

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
		.app-shell.sidebar-collapsed #sessionMenuButton,
		.app-shell.sidebar-collapsed .thread-list,
		.app-shell.sidebar-collapsed .sidebar-footer {
			display: none;
		}
		.app-shell.sidebar-collapsed .brand-row {
			justify-content: center;
			width: 100%;
		}
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
		.search-box {
			display: flex;
			align-items: center;
			gap: 10px;
			min-height: 36px;
			padding: 0 10px;
			border: 1px solid transparent;
			border-radius: 8px;
			color: var(--muted-foreground);
			font-size: 13px;
		}
		.search-box input {
			width: 100%;
			border: 0;
			background: transparent;
			color: var(--foreground);
			font: inherit;
			outline: 0;
		}
		.search-box input::placeholder {
			color: var(--muted-foreground);
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
			padding: 12px 14px;
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
			gap: 16px;
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
			margin-left: max(16px, calc(50% - 340px));
			margin-right: max(16px, calc(50% - 340px));
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
			margin-right: max(16px, calc(50% - 340px));
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
			width: min(680px, calc(100vw - 32px));
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
			background: var(--bg-surface);
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
			color: var(--text);
		}
		.close-button {
			background: transparent;
			color: var(--text-muted);
			font-size: 1.5rem;
			padding: 0 4px;
			line-height: 1;
		}
		.close-button:hover {
			color: var(--text);
		}
		.modal-body {
			padding: 20px;
			color: var(--text-muted);
			font-size: 0.95rem;
		}
		
		/* Image Upload Preview */
		.composer-preview {
			display: flex;
			gap: 8px;
			padding: 8px 12px 0;
			flex-wrap: wrap;
		}
		.composer-preview img {
			height: 48px;
			border-radius: 4px;
			border: 1px solid var(--border);
			object-fit: contain;
		}
		.message-image {
			max-width: 100%;
			max-height: 300px;
			border-radius: 6px;
			margin-bottom: 8px;
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
	<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js" nonce="${nonce}"></script>
</head>
<body>
	<div class="app-shell">
		<aside class="sidebar" aria-label="Nanocoder sessions">
			<div class="brand-row">
				<div class="brand">
					<span>Nanocoder</span>
				</div>
				<div class="brand-actions">
					<button class="icon-button" id="sessionMenuButton" type="button" aria-label="Session menu">⌘</button>
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
				<div class="composer-preview" id="imagePreviewContainer" hidden></div>
				<div class="composer">
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
				<div class="setting-group">
					<p>Settings configuration is not yet available in the Web Mode interface. Check back later!</p>
				</div>
			</div>
		</div>
	</div>

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
			const sessionMenuButton = document.querySelector('#sessionMenuButton');
			const historyButton = document.querySelector('#historyButton');
			const settingsButton = document.querySelector('#settingsButton');
			const composerNote = document.querySelector('#composerNote');
			const threadSearchInput = document.querySelector('#threadSearchInput');
			const threadList = document.querySelector('#threadList');
			
			const settingsModal = document.querySelector('#settingsModal');
			const closeSettingsButton = document.querySelector('#closeSettingsButton');
			const imageUploadInput = document.querySelector('#imageUploadInput');
			const uploadImageButton = document.querySelector('#uploadImageButton');
			const imagePreviewContainer = document.querySelector('#imagePreviewContainer');
			let pendingImages = [];
			const token = new URLSearchParams(window.location.search).get('token');
			const eventsUrl = new URL('/events', window.location.href);
			eventsUrl.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			eventsUrl.searchParams.set('token', token ?? '');
			const storageKey = 'nanocoder.webMode.localSession.v1';
			const pendingMessages = new Map();
			const assistantMessages = new Map();
			let messageCounter = 0;
			let storedMessages = [];
			let activeTurnId = null;
			let isConnected = false;
			let socket = null;
			let reconnectTimer = null;
			let reconnectDelayMs = 1000;
			const maxReconnectDelayMs = 15000;

			// Initial load animation
			gsap.from('.sidebar', { opacity: 0, x: -20, duration: 0.6, ease: 'power2.out' });
			gsap.from('.topbar', { opacity: 0, y: -10, duration: 0.5, ease: 'power2.out', delay: 0.1 });
			gsap.from('.composer-wrap', { opacity: 0, duration: 0.6, ease: 'power2.out', delay: 0.2 });


			// Custom helper to animate elements in
			function animateIn(element) {
				gsap.fromTo(element, { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' });
			}


			const themeStorageKey = 'nanocoder.webMode.theme.v1';
			const sidebarStorageKey = 'nanocoder.webMode.sidebarCollapsed.v1';

			function applyTheme(theme) {
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
				window.localStorage.setItem(themeStorageKey, theme);
			}

			function initialTheme() {
				const stored = window.localStorage.getItem(themeStorageKey);
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
				window.localStorage.setItem(sidebarStorageKey, String(isCollapsed));
			}

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
						highlightCode(codeElement, codeRawText, codeLang);
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

			function appendMessage(role, text, metaText, shouldStore = true, images = []) {
				hideEmptyState();
				const messageElement = document.createElement('div');
				messageElement.className = 'message ' + role;

				if (images && images.length > 0) {
					const imageContainer = document.createElement('div');
					imageContainer.className = 'message-images';
					for (const img of images) {
						const imgEl = document.createElement('img');
						imgEl.className = 'message-image';
						imgEl.src = img.data;
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

				if (metaText) {
					const metaElement = document.createElement('div');
					metaElement.className = 'meta';
					metaElement.textContent = metaText;
					messageElement.append(metaElement);
				}

				messageList.append(messageElement);
				messageList.scrollTop = messageList.scrollHeight;

				animateIn(messageElement);

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
				setEmptyState('How can I help you?', '');
				messageInput.value = '';
				messageInput.focus();
				activeSessionId = null;
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
				threadList.replaceChildren();

				if (sessions.length === 0) {
					const empty = document.createElement('p');
					empty.className = 'thread-list-empty';
					empty.textContent = 'No saved sessions yet.';
					threadList.append(empty);
					return;
				}

				for (const session of sessions) {
					const item = document.createElement('button');
					item.className = 'thread-item' + (session.id === activeSessionId ? ' active' : '');
					item.type = 'button';
					item.dataset.sessionId = session.id;
					item.dataset.threadLabel = session.title;
					
					const textSpan = document.createElement('span');
					textSpan.className = 'thread-item-text';
					const relative = formatRelativeTime(session.lastAccessedAt);
					textSpan.textContent = session.title + (relative ? ' · ' + relative : '');
					
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
						
						const updatedSessions = currentSessions.filter(s => s.id !== session.id);
						renderThreadList(updatedSessions);
						
						if (session.id === activeSessionId) {
							newChatButton.click();
						}
					});

					item.append(textSpan, deleteBtn);
					threadList.append(item);
				}
			}

			function applyLoadedSession(sessionSummary, messages) {
				activeSessionId = sessionSummary.id;
				storedMessages = [];
				pendingMessages.clear();
				assistantMessages.clear();
				messageList.replaceChildren();

				if (messages.length === 0) {
					setEmptyState('How can I help you?', '');
				} else {
					hideEmptyState();
					for (const message of messages) {
						appendMessage(message.role, message.content);
					}
				}

				messageInput.value = '';
				renderThreadList(currentSessions);
				addSystemNotice('Resumed session: ' + sessionSummary.title, 'Session switch');
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
				hideEmptyState();
				const messageElement = document.createElement('div');
				messageElement.className = 'message system interaction';
				const card = document.createElement('div');
				card.className = 'interaction-card';

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
				messageList.append(messageElement);
				messageList.scrollTop = messageList.scrollHeight;

				const respond = (approved) => {
					disableInteractionCard(card);
					const meta = document.createElement('div');
					meta.className = 'meta';
					meta.textContent = approved ? 'Approved' : 'Denied';
					messageElement.append(meta);
					sendClientEvent({
						type: 'approval_response',
						id: message.id,
						approved,
					});
				};

				approveButton.addEventListener('click', () => respond(true));
				denyButton.addEventListener('click', () => respond(false));
			}

			function renderQuestionCard(message) {
				hideEmptyState();
				const messageElement = document.createElement('div');
				messageElement.className = 'message system interaction';
				const card = document.createElement('div');
				card.className = 'interaction-card';

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
				if (message.type === 'ready') {
					setStatus('Connected', 'connected');
					setComposerEnabled(true);
					if (storedMessages.length === 0) {
						setEmptyState('How can I help you?', '');
					}
					messageInput.focus();
					sendClientEvent({type: 'list_sessions', id: 'browser-sessions-' + Date.now()});
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
					appendMessage('system tool-status', 'Running tool: ' + message.name, 'In progress');
					return;
				}

				if (message.type === 'tool_finished') {
					appendMessage(
						'system tool-status',
						'Tool finished: ' + message.name,
						message.ok ? 'Completed' : 'Failed',
					);
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
					if (message.id === activeTurnId) {
						setActiveTurn(null);
						messageInput.focus();
					}
					return;
				}

				if (message.type === 'error') {
					setActiveTurn(null);
					const pendingMessageElement = message.id
						? pendingMessages.get(message.id)
						: undefined;
					if (pendingMessageElement) {
						const failedText =
							pendingMessageElement.querySelector('.message-content').textContent;
						updateMessageMeta(pendingMessageElement, 'Not sent — ' + message.message);
						pendingMessages.delete(message.id);
						setPromptText(failedText);
					} else {
						appendMessage('system error', message.message);
					}
					return;
				}

				if (message.type === 'sessions') {
					renderThreadList(message.sessions);
					return;
				}

				if (message.type === 'session_loaded') {
					applyLoadedSession(message.session, message.messages);
					return;
				}

				appendMessage('system', 'Received an unsupported local session event.');
			}

			function submitUserMessage(text) {
				if (activeTurnId) {
					return;
				}

				const trimmedText = text.trim();
				if (!trimmedText && pendingImages.length === 0) {
					return;
				}

				const id = 'browser-message-' + Date.now() + '-' + messageCounter++;
				const messageElement = appendMessage('user', trimmedText, 'Sending...', true, pendingImages);
				pendingMessages.set(id, messageElement);
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
					for (const img of pendingImages) {
						const imgEl = document.createElement('img');
						imgEl.src = img.data;
						imagePreviewContainer.append(imgEl);
					}
				} else {
					imagePreviewContainer.hidden = true;
				}
			}

			function handleFiles(files) {
				for (const file of files) {
					if (!file.type.startsWith('image/')) continue;
					const reader = new FileReader();
					reader.onload = e => {
						pendingImages.push({ data: e.target.result, mediaType: file.type });
						renderImagePreviews();
					};
					reader.readAsDataURL(file);
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
			applySidebarCollapsed(window.localStorage.getItem(sidebarStorageKey) === 'true');

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
				if (!activeTurnId) {
					sendButton.disabled = messageInput.value.trim().length === 0 && pendingImages.length === 0;
				}
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
				sendClientEvent({type: 'reset_session', id: 'browser-reset-' + Date.now()});
				clearLocalSession();
				addSystemNotice('Started a fresh local browser session.', 'Stored only in this browser');
			});

			themeToggleButton.addEventListener('click', () => {
				applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
			});

			if (sidebarToggleButton) sidebarToggleButton.addEventListener('click', () => {
				applySidebarCollapsed(!appShell.classList.contains('sidebar-collapsed'));
			});

			sessionMenuButton.addEventListener('click', () => {
				addSystemNotice(
					'This session is served from localhost and protected by the private URL token. The live connection uses ws:// rather than wss:// because it never leaves your machine.',
					'Session menu',
				);
			});

			if (historyButton) historyButton.addEventListener('click', () => {
				if (appShell.classList.contains('sidebar-collapsed')) {
					applySidebarCollapsed(false);
				}
				sendClientEvent({
					type: 'list_sessions',
					id: 'browser-sessions-' + Date.now(),
				});
				if (threadSearchInput) threadSearchInput.focus();
			});

			if (settingsButton) settingsButton.addEventListener('click', () => {
				settingsModal.classList.remove('hidden');
			});
			closeSettingsButton.addEventListener('click', () => {
				settingsModal.classList.add('hidden');
			});
			settingsModal.addEventListener('click', event => {
				if (event.target === settingsModal) {
					settingsModal.classList.add('hidden');
				}
			});

			if (threadSearchInput) threadSearchInput.addEventListener('input', () => {
				const query = threadSearchInput.value.trim().toLowerCase();
				for (const threadButton of threadList.querySelectorAll('.thread-item')) {
					const label = (threadButton.dataset.threadLabel || '').toLowerCase();
					threadButton.hidden = query.length > 0 && !label.includes(query);
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
