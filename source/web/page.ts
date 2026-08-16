import {randomBytes} from 'node:crypto';

export const nanocoderLogoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Nanocoder">
<rect width="64" height="64" rx="12" fill="#02191d"/>
<path fill="#bb9af7" d="M8 17h7v30H8zM26 17h7v30h-7zM15 22h6v8h-6zM20 28h7v8h-7zM24 35h6v8h-6z"/>
<rect x="39" y="17" width="7" height="30" fill="#7dcfff"/>
<rect x="46" y="17" width="11" height="7" fill="#7dcfff"/>
<rect x="46" y="40" width="11" height="7" fill="#7dcfff"/>
</svg>`;

export function createPageNonce(): string {
	return randomBytes(16).toString('base64');
}

export function renderWebModePage(nonce: string = createPageNonce()): string {
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Nanocoder Web Mode</title>
	<link rel="icon" type="image/svg+xml" href="/assets/nanocoder-icon.svg">
	<style nonce="${nonce}">
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
		.app-shell.sidebar-collapsed {
			grid-template-columns: 0 minmax(0, 1fr);
		}
		.app-shell.sidebar-collapsed .sidebar {
			padding: 0;
			border-right: 0;
			opacity: 0;
			pointer-events: none;
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
			transition: opacity 150ms ease;
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
		.icon-button:hover,
		.icon-button:focus-visible {
			background: rgba(245, 242, 235, 0.11);
			outline: 0;
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
			scrollbar-width: thin;
			scrollbar-color: rgba(245, 242, 235, 0.18) transparent;
		}
		.thread-list::-webkit-scrollbar {
			width: 8px;
		}
		.thread-list::-webkit-scrollbar-thumb {
			background: rgba(245, 242, 235, 0.18);
			border-radius: 8px;
		}
		.thread-list::-webkit-scrollbar-thumb:hover {
			background: rgba(245, 242, 235, 0.3);
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
		.thread-item:hover,
		.thread-item:focus-visible {
			background: rgba(245, 242, 235, 0.055);
			color: #f5f2eb;
			outline: 0;
		}
		.sidebar-footer {
			display: flex;
			align-items: center;
			justify-content: space-between;
			color: #9b92a4;
			font-size: 13px;
		}
		.thread-list-empty {
			margin: 0;
			padding: 6px 10px;
			color: #8e969d;
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
			scrollbar-width: thin;
			scrollbar-color: rgba(245, 242, 235, 0.18) transparent;
		}
		.messages::-webkit-scrollbar {
			width: 10px;
		}
		.messages::-webkit-scrollbar-thumb {
			background: rgba(245, 242, 235, 0.18);
			border-radius: 8px;
		}
		.messages::-webkit-scrollbar-thumb:hover {
			background: rgba(245, 242, 235, 0.3);
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
			align-self: center;
			width: min(760px, 100%);
			background: rgba(8, 9, 11, 0.26);
			color: #beb7c7;
		}
		.message.interaction {
			align-self: stretch;
			width: min(760px, 100%);
			border-color: rgba(125, 207, 255, 0.28);
			background: rgba(36, 40, 59, 0.92);
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
			color: #f5f2eb;
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
			color: #f5f2eb;
		}
		.message.tool-status {
			align-self: center;
			width: min(760px, 100%);
			border-style: dashed;
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
			color: rgba(245, 242, 235, 0.5);
			font-size: 11px;
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
		.send-button:not(:disabled):hover,
		.send-button:not(:disabled):focus-visible {
			transform: translateY(-1px);
			background: #6ee7a1;
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
		.icon-button:hover,
		.icon-button:focus-visible {
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
		.thread-list-empty,
		.sidebar-footer,
		.session-note,
		p,
		.empty-state span,
		.note {
			color: var(--tn-secondary);
		}
		.thread-item.active,
		.thread-item:hover,
		.thread-item:focus-visible,
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
			color: rgba(192, 202, 245, 0.52);
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
		.send-button:not(:disabled):hover,
		.send-button:not(:disabled):focus-visible {
			background: #9de1ff;
		}
		/*
		 * Light theme. Scoped with the [data-theme="light"] attribute selector
		 * (set on <html> by the theme toggle below) rather than editing the dark
		 * rules above, so light mode is purely additive: the attribute selector
		 * always outranks the plain class selectors it targets, regardless of
		 * source order, and the dark theme's appearance is provably unchanged.
		 */
		:root[data-theme="light"] {
			color-scheme: light;
		}
		:root[data-theme="light"] body {
			background: #f6f6fb;
			color: #1c1d2b;
		}
		:root[data-theme="light"] .app-shell {
			background:
				linear-gradient(90deg, #ffffff 0, #ffffff 280px, #f6f6fb 280px, #f0f0f7 100%);
		}
		:root[data-theme="light"] .sidebar {
			border-right-color: rgba(28, 29, 43, 0.1);
			background: #ffffff;
		}
		:root[data-theme="light"] .brand,
		:root[data-theme="light"] .thread-item.active,
		:root[data-theme="light"] .thread-item:hover,
		:root[data-theme="light"] .prompt-button:hover,
		:root[data-theme="light"] .empty-state,
		:root[data-theme="light"] .message,
		:root[data-theme="light"] textarea,
		:root[data-theme="light"] .model-pill {
			color: #1c1d2b;
		}
		:root[data-theme="light"] .icon-button {
			background: rgba(28, 29, 43, 0.06);
			color: #1c1d2b;
		}
		:root[data-theme="light"] .icon-button:hover,
		:root[data-theme="light"] .icon-button:focus-visible {
			background: rgba(28, 29, 43, 0.1);
		}
		:root[data-theme="light"] .new-chat {
			border-color: rgba(124, 92, 214, 0.4);
			background: rgba(124, 92, 214, 0.1);
			color: #5c3fb8;
		}
		:root[data-theme="light"] .new-chat:hover {
			background: rgba(124, 92, 214, 0.18);
		}
		:root[data-theme="light"] .search-box {
			border-color: rgba(28, 29, 43, 0.1);
			color: #5b6178;
		}
		:root[data-theme="light"] .search-box:focus-within {
			border-color: rgba(46, 134, 193, 0.4);
			background: rgba(46, 134, 193, 0.06);
		}
		:root[data-theme="light"] .search-box input {
			color: #1c1d2b;
		}
		:root[data-theme="light"] .search-box input::placeholder,
		:root[data-theme="light"] .thread-item,
		:root[data-theme="light"] .thread-list-empty,
		:root[data-theme="light"] .sidebar-footer,
		:root[data-theme="light"] .session-note,
		:root[data-theme="light"] p,
		:root[data-theme="light"] .empty-state span,
		:root[data-theme="light"] .note {
			color: #5b6178;
		}
		:root[data-theme="light"] .thread-list::-webkit-scrollbar-thumb,
		:root[data-theme="light"] .messages::-webkit-scrollbar-thumb {
			background: rgba(28, 29, 43, 0.16);
		}
		:root[data-theme="light"] .thread-list::-webkit-scrollbar-thumb:hover,
		:root[data-theme="light"] .messages::-webkit-scrollbar-thumb:hover {
			background: rgba(28, 29, 43, 0.28);
		}
		:root[data-theme="light"] .thread-list,
		:root[data-theme="light"] .messages {
			scrollbar-color: rgba(28, 29, 43, 0.16) transparent;
		}
		:root[data-theme="light"] .thread-item.active,
		:root[data-theme="light"] .thread-item:hover,
		:root[data-theme="light"] .thread-item:focus-visible,
		:root[data-theme="light"] .mode-pill,
		:root[data-theme="light"] .prompt-button:hover {
			background: rgba(46, 134, 193, 0.1);
		}
		:root[data-theme="light"] .workspace {
			background:
				radial-gradient(circle at 50% 16%, rgba(124, 92, 214, 0.08), transparent 28rem),
				linear-gradient(180deg, #f6f6fb 0%, #f2f2f8 52%, #ececf4 100%);
		}
		:root[data-theme="light"] .status {
			border-color: rgba(28, 29, 43, 0.12);
			background: rgba(255, 255, 255, 0.78);
			color: #1c1d2b;
		}
		:root[data-theme="light"] .status::before {
			background: #b3791f;
			box-shadow: 0 0 0 5px rgba(179, 121, 31, 0.14);
		}
		:root[data-theme="light"] .status.connected {
			color: #1a9e63;
		}
		:root[data-theme="light"] .status.connected::before {
			background: #1a9e63;
			box-shadow: 0 0 0 5px rgba(26, 158, 99, 0.14);
		}
		:root[data-theme="light"] .status.disconnected,
		:root[data-theme="light"] .status.failed,
		:root[data-theme="light"] .message.error {
			color: #b8253f;
		}
		:root[data-theme="light"] .status.disconnected::before,
		:root[data-theme="light"] .status.failed::before {
			background: #d1435b;
			box-shadow: 0 0 0 5px rgba(209, 67, 91, 0.14);
		}
		:root[data-theme="light"] .markdown h1,
		:root[data-theme="light"] .markdown h2,
		:root[data-theme="light"] .markdown h3 {
			color: #1c1d2b;
		}
		:root[data-theme="light"] .markdown code {
			background: rgba(46, 134, 193, 0.1);
		}
		:root[data-theme="light"] .markdown pre,
		:root[data-theme="light"] .interaction-card pre {
			border-color: rgba(28, 29, 43, 0.12);
			background: #eef0f7;
		}
		:root[data-theme="light"] .tok-keyword {
			color: #5c3fb8;
		}
		:root[data-theme="light"] .tok-string {
			color: #1a9e63;
		}
		:root[data-theme="light"] .tok-number {
			color: #b3791f;
		}
		:root[data-theme="light"] .tok-comment {
			color: #5b6178;
		}
		:root[data-theme="light"] .message {
			border-color: rgba(28, 29, 43, 0.1);
			background: rgba(28, 29, 43, 0.035);
			box-shadow: 0 12px 40px rgba(28, 29, 43, 0.06);
		}
		:root[data-theme="light"] .message.user {
			background: #1c1d2b;
			color: #fbfbfd;
		}
		:root[data-theme="light"] .message.user .meta {
			color: rgba(251, 251, 253, 0.62);
		}
		:root[data-theme="light"] .message.assistant {
			background: transparent;
		}
		:root[data-theme="light"] .message.system,
		:root[data-theme="light"] .mode-pill {
			background: rgba(28, 29, 43, 0.045);
		}
		:root[data-theme="light"] .message.system {
			color: #1c1d2b;
		}
		:root[data-theme="light"] .message.interaction {
			border-color: rgba(46, 134, 193, 0.3);
			background: rgba(46, 134, 193, 0.06);
		}
		:root[data-theme="light"] .interaction-actions button,
		:root[data-theme="light"] .question-options button {
			border-color: rgba(46, 134, 193, 0.32);
			background: rgba(46, 134, 193, 0.1);
			color: #1c1d2b;
		}
		:root[data-theme="light"] .interaction-actions button[data-approved="false"] {
			border-color: rgba(209, 67, 91, 0.35);
			background: rgba(209, 67, 91, 0.1);
		}
		:root[data-theme="light"] .question-freeform input {
			border-color: rgba(28, 29, 43, 0.14);
			background: #ffffff;
			color: #1c1d2b;
		}
		:root[data-theme="light"] .mode-pill {
			border-color: rgba(28, 29, 43, 0.1);
		}
		:root[data-theme="light"] .mode-pill:hover,
		:root[data-theme="light"] .mode-pill:focus-visible {
			background: rgba(46, 134, 193, 0.12);
			border-color: rgba(46, 134, 193, 0.36);
			color: #1c1d2b;
		}
		:root[data-theme="light"] .prompt-button {
			border-color: rgba(28, 29, 43, 0.1);
			background: rgba(28, 29, 43, 0.025);
			color: #33364a;
		}
		:root[data-theme="light"] .prompt-button::after {
			color: rgba(46, 134, 193, 0.6);
		}
		:root[data-theme="light"] .prompt-button:hover,
		:root[data-theme="light"] .prompt-button:focus-visible {
			border-color: rgba(46, 134, 193, 0.32);
			color: #1c1d2b;
		}
		:root[data-theme="light"] .prompt-button:hover::after,
		:root[data-theme="light"] .prompt-button:focus-visible::after {
			color: #2e86c1;
		}
		:root[data-theme="light"] .message.error {
			border-color: rgba(209, 67, 91, 0.4);
		}
		:root[data-theme="light"] .meta {
			color: rgba(28, 29, 43, 0.48);
		}
		:root[data-theme="light"] .composer {
			border-color: rgba(28, 29, 43, 0.12);
			background: #ffffff;
			box-shadow: 0 24px 80px rgba(28, 29, 43, 0.1);
		}
		:root[data-theme="light"] .composer.is-attention {
			border-color: rgba(46, 134, 193, 0.5);
			box-shadow:
				0 0 0 3px rgba(46, 134, 193, 0.14),
				0 24px 80px rgba(28, 29, 43, 0.1);
		}
		:root[data-theme="light"] textarea::placeholder {
			color: #7d8296;
		}
		:root[data-theme="light"] .send-button {
			background: #2e86c1;
			color: #ffffff;
		}
		:root[data-theme="light"] .send-button:not(:disabled):hover,
		:root[data-theme="light"] .send-button:not(:disabled):focus-visible {
			background: #3f99d6;
		}
		:root[data-theme="light"] .send-button.is-cancel {
			background: #d1435b;
			color: #ffffff;
		}
		:root[data-theme="light"] .send-button.is-cancel:not(:disabled):hover,
		:root[data-theme="light"] .send-button.is-cancel:not(:disabled):focus-visible {
			background: #dd5b71;
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
				<button class="icon-button" id="themeToggleButton" type="button" aria-label="Switch to light theme" aria-pressed="false">◐</button>
				<button class="icon-button" id="sessionMenuButton" type="button" aria-label="Session menu">⌘</button>
			</div>
			<button class="new-chat" id="newChatButton" type="button">New Chat</button>
			<label class="search-box">
				<span>⌕</span>
				<input id="threadSearchInput" type="search" placeholder="Search local threads..." autocomplete="off">
			</label>
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
				<div class="top-actions">
					<button class="icon-button" id="sidebarToggleButton" type="button" aria-label="Collapse sidebar" aria-expanded="true">❮</button>
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
			let socket = null;
			let reconnectTimer = null;
			let reconnectDelayMs = 1000;
			const maxReconnectDelayMs = 15000;

			const themeStorageKey = 'nanocoder.webMode.theme.v1';
			const sidebarStorageKey = 'nanocoder.webMode.sidebarCollapsed.v1';

			function applyTheme(theme) {
				document.documentElement.dataset.theme = theme;
				const isLight = theme === 'light';
				themeToggleButton.textContent = isLight ? '◑' : '◐';
				themeToggleButton.setAttribute('aria-pressed', String(isLight));
				themeToggleButton.setAttribute(
					'aria-label',
					isLight ? 'Switch to dark theme' : 'Switch to light theme',
				);
				window.localStorage.setItem(themeStorageKey, theme);
			}

			function initialTheme() {
				const stored = window.localStorage.getItem(themeStorageKey);
				if (stored === 'light' || stored === 'dark') {
					return stored;
				}
				return window.matchMedia('(prefers-color-scheme: light)').matches
					? 'light'
					: 'dark';
			}

			function applySidebarCollapsed(isCollapsed) {
				appShell.classList.toggle('sidebar-collapsed', isCollapsed);
				sidebarToggleButton.textContent = isCollapsed ? '❯' : '❮';
				sidebarToggleButton.setAttribute('aria-expanded', String(!isCollapsed));
				sidebarToggleButton.setAttribute(
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
					const button = document.createElement('button');
					button.className =
						'thread-item' + (session.id === activeSessionId ? ' active' : '');
					button.type = 'button';
					button.dataset.sessionId = session.id;
					button.dataset.threadLabel = session.title;
					const marker = session.id === activeSessionId ? '●' : '○';
					const relative = formatRelativeTime(session.lastAccessedAt);
					button.textContent =
						marker + ' ' + session.title + (relative ? ' · ' + relative : '');
					threadList.append(button);
				}
			}

			function applyLoadedSession(sessionSummary, messages) {
				activeSessionId = sessionSummary.id;
				storedMessages = [];
				pendingMessages.clear();
				assistantMessages.clear();
				messageList.replaceChildren();

				if (messages.length === 0) {
					setEmptyState('How can I help you?', '', true);
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
						setEmptyState('How can I help you?', '', true);
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
					setEmptyState(
						'Reconnecting…',
						'Trying to reach the local Nanocoder server again.',
					);
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

			setEmptyState('How can I help you?', '', true);
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

			messageInput.addEventListener('keydown', event => {
				if (event.key === 'Enter' && !event.shiftKey) {
					event.preventDefault();
					messageForm.requestSubmit();
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

			sidebarToggleButton.addEventListener('click', () => {
				applySidebarCollapsed(!appShell.classList.contains('sidebar-collapsed'));
			});

			sessionMenuButton.addEventListener('click', () => {
				addSystemNotice(
					'This session is served from localhost and protected by the private URL token. The live connection uses ws:// rather than wss:// because it never leaves your machine.',
					'Session menu',
				);
			});

			historyButton.addEventListener('click', () => {
				if (appShell.classList.contains('sidebar-collapsed')) {
					applySidebarCollapsed(false);
				}
				sendClientEvent({
					type: 'list_sessions',
					id: 'browser-sessions-' + Date.now(),
				});
				threadSearchInput.focus();
			});

			settingsButton.addEventListener('click', () => {
				const theme =
					document.documentElement.dataset.theme === 'light' ? 'Light' : 'Dark';
				const sidebarState = appShell.classList.contains('sidebar-collapsed')
					? 'collapsed'
					: 'expanded';
				addSystemNotice(
					'Theme: ' +
						theme +
						'. Sidebar: ' +
						sidebarState +
						'. Provider and model stay in the terminal runtime; during a browser turn, approvals and questions are answered here.',
					'Session settings',
				);
			});

			threadSearchInput.addEventListener('input', () => {
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
