#!/usr/bin/env node

/**
 * Verifies that the compiled chat-panel.css retains VS Code theme tokens.
 *
 * Tailwind v4 can silently strip custom CSS variables when purge detects
 * them as unused. This script ensures the built CSS still contains
 * --vscode-* property references so the webview can read them at runtime.
 */

const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.resolve(__dirname, '..', 'media', 'chat-panel.css');

if (!fs.existsSync(CSS_PATH)) {
	console.error(`CSS file not found: ${CSS_PATH}`);
	process.exit(1);
}

const css = fs.readFileSync(CSS_PATH, 'utf-8');

if (css.trim().length === 0) {
	console.error('chat-panel.css is empty');
	process.exit(1);
}

const vscodeTokens = css.match(/--vscode-[\w-]+/g) || [];
const uniqueTokens = [...new Set(vscodeTokens)];

if (uniqueTokens.length === 0) {
	console.error(
		'No --vscode-* theme tokens found in chat-panel.css. ' +
			'Tailwind may have stripped them during compilation.',
	);
	process.exit(1);
}

console.log(
	`OK: chat-panel.css contains ${uniqueTokens.length} VS Code theme tokens`,
);
