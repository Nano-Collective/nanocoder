#!/usr/bin/env node
// Asserts that utility classes used in the chat-panel HTML/JS are present in the compiled CSS.
// Dependency-free script to prevent silent failures where the .vsix builds but lacks theme colors.

import {readFileSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const cssPath = join(pkgRoot, 'media', 'chat-panel.css');
const htmlPath = join(pkgRoot, 'media', 'chat-panel.html');
const jsPath = join(pkgRoot, 'media', 'chat-panel.js');

if (!existsSync(cssPath)) {
	console.error(
		`verify-theme-css: ${cssPath} is missing. Run \`pnpm run build:vscode\` first.`,
	);
	process.exit(1);
}

// Extract vscode-* Tailwind classes (including variant prefixes like hover:).
// 'vscode-…' must precede 'vscode' to avoid partial matches.
const tailwindClass = /(?:[a-zA-Z-]+:)*[a-zA-Z][\w-]*-(?:vscode-[\w-]+|vscode)\b/g;

const referenced = new Set();
for (const path of [htmlPath, jsPath]) {
	if (!existsSync(path)) continue;
	const text = readFileSync(path, 'utf8');
	for (const match of text.match(tailwindClass) ?? []) {
		referenced.add(match);
	}
}

// Spot-check critical tokens whose absence would be visually obvious.
const requiredTokens = [
	'bg-vscode-bg',
	'text-vscode-fg',
	'bg-vscode-input-bg',
	'border-vscode-input-border',
	'bg-vscode-button-bg',
	'text-vscode-button-fg',
	'border-vscode-border',
];

const css = readFileSync(cssPath, 'utf8');

// Escape colons for variant selectors (e.g. .hover\:bg-vscode-foo).
function compiledSelectorFor(token) {
	return token.replaceAll(':', '\\\\:');
}

function compiledAsClass(token) {
	const selector = compiledSelectorFor(token);
	// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
	return new RegExp(`\\.${selector}(?![\\w-])`).test(css);
}

const missing = [...referenced].filter((cls) => !compiledAsClass(cls));

const missingRequired = requiredTokens.filter(
	// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
	(token) => !new RegExp(`\\.${token}(?![\\w-])`).test(css),
);

if (missing.length === 0 && missingRequired.length === 0) {
	const scanned = referenced.size;
	console.log(
		`verify-theme-css: ok — ${scanned} theme class(es) found in ${cssPath}`,
	);
	process.exit(0);
}

console.error(
	'verify-theme-css: the compiled CSS is missing theme utilities referenced',
);
console.error('  by the webview templates. The webview would render unthemed.');
console.error('');

if (missingRequired.length > 0) {
	console.error('Required tokens that did not compile:');
	for (const token of missingRequired) {
		console.error(`  - .${token}`);
	}
	console.error('');
}

if (missing.length > 0) {
	const preview = missing.slice(0, 20);
	console.error(`Other missing classes (${missing.length} total, showing first ${preview.length}):`);
	for (const cls of preview) {
		console.error(`  - .${cls}`);
	}
	if (missing.length > preview.length) {
		console.error(`  ... and ${missing.length - preview.length} more`);
	}
	console.error('');
}

console.error(
	'This usually means the Tailwind theme moved (e.g. tailwind.config.js no',
);
console.error(
	'longer being read by Tailwind v4) or @theme tokens were deleted. Check',
);
console.error('that src/styles.css declares every `--color-vscode-*` used by');
console.error('media/chat-panel.{html,js}.');

process.exit(1);
