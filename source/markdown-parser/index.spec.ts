import test from 'ava';
import stripAnsi from 'strip-ansi';
import type {Colors} from '../types/markdown-parser.js';
import {parseMarkdown} from './index.js';

console.log(`\nindex.spec.ts`);

const mockColors: Colors = {
	primary: '#3b82f6',
	secondary: '#6b7280',
	success: '#10b981',
	error: '#ef4444',
	warning: '#f59e0b',
	info: '#3b82f6',
	text: '#ffffff',
	tool: '#8b5cf6',
};

// Inline code tests
test('parseMarkdown handles inline code', t => {
	const text = 'Use `npm install` to install packages';
	const result = parseMarkdown(text, mockColors);
	t.true(result.includes('npm install'));
	t.false(result.includes('`npm install`'));
});

// Bold and italic tests
test('parseMarkdown handles bold text', t => {
	const text = 'This is **bold** text';
	const result = parseMarkdown(text, mockColors);
	t.true(result.includes('bold'));
});

test('parseMarkdown handles italic text', t => {
	const text = 'This is *italic* text';
	const result = parseMarkdown(text, mockColors);
	t.true(result.includes('italic'));
});

// Underscore preservation tests
test('parseMarkdown preserves underscores in identifiers', t => {
	const text =
		'Use `create_file`, `read_file`, or `search_file_contents` functions';
	const result = parseMarkdown(text, mockColors);
	t.true(result.includes('create_file'));
	t.true(result.includes('read_file'));
	t.true(result.includes('search_file_contents'));
});

test('parseMarkdown preserves underscores in regular text', t => {
	const text = 'The variable_name and function_call should remain intact';
	const result = parseMarkdown(text, mockColors);
	t.true(result.includes('variable_name'));
	t.true(result.includes('function_call'));
});

// Heading tests
test('parseMarkdown handles headings', t => {
	const text = '# Heading 1\n## Heading 2\n### Heading 3';
	const result = parseMarkdown(text, mockColors);
	t.true(result.includes('Heading 1'));
	t.true(result.includes('Heading 2'));
	t.true(result.includes('Heading 3'));
});

// Link tests
test('parseMarkdown handles links', t => {
	const text = 'Visit [Google](https://google.com) for search';
	const result = parseMarkdown(text, mockColors);
	t.true(result.includes('Google'));
	t.true(result.includes('https://google.com'));
});

// Blockquote tests
test('parseMarkdown handles blockquotes', t => {
	const text = '> This is a quote\n> Another line';
	const result = parseMarkdown(text, mockColors);
	t.true(result.includes('This is a quote'));
	t.true(result.includes('Another line'));
});

// List tests
test('parseMarkdown handles unordered lists', t => {
	const text = '- Item 1\n- Item 2\n- Item 3';
	const result = parseMarkdown(text, mockColors);
	t.true(result.includes('•'));
	t.true(result.includes('Item 1'));
	t.true(result.includes('Item 2'));
});

test('parseMarkdown handles ordered lists', t => {
	const text = '1. First\n2. Second\n3. Third';
	const result = parseMarkdown(text, mockColors);
	t.true(result.includes('1.'));
	t.true(result.includes('2.'));
	t.true(result.includes('3.'));
	t.true(result.includes('First'));
	t.true(result.includes('Second'));
});

test('parseMarkdown handles nested/indented bullet lists', t => {
	const text = `- Top level item
  - Nested item 1
  - Nested item 2
    - Double nested
- Another top level`;
	const result = parseMarkdown(text, mockColors);
	const plainResult = stripAnsi(result);
	t.true(plainResult.includes('  • Nested item 1'));
	t.true(plainResult.includes('    • Double nested'));
});

test('parseMarkdown handles nested numbered lists', t => {
	const text = `1. First level
  1. Nested first
  2. Nested second
2. Back to first level`;
	const result = parseMarkdown(text, mockColors);
	const plainResult = stripAnsi(result);
	t.true(plainResult.includes('  1. Nested first'));
	t.true(plainResult.includes('  2. Nested second'));
});

// HTML entity tests
test('parseMarkdown decodes HTML entities', t => {
	const text = '&lt;div&gt; &amp; &copy;';
	const result = parseMarkdown(text, mockColors);
	t.true(result.includes('<div>'));
	t.true(result.includes('&'));
	t.true(result.includes('©'));
});

// Table tests
test('parseMarkdown handles tables', t => {
	const text = `| Name | Age |
|------|-----|
| John | 25  |`;
	const result = parseMarkdown(text, mockColors);
	t.true(result.includes('Name'));
	t.true(result.includes('John'));
});

test('parseMarkdown renders tables with plain text (no markdown)', t => {
	const text = `| Command | Description |
|---------|-------------|
| \`npm install\` | Install dependencies |
| \`npm start\` | Start the application |`;
	const result = parseMarkdown(text, mockColors);
	t.true(result.includes('npm install'));
	t.true(result.includes('npm start'));
	t.false(result.includes('`npm install`'));
});

// Code block tests
test('parseMarkdown handles code blocks with language', t => {
	const text = '```javascript\nconst x = 5;\n```';
	const result = parseMarkdown(text, mockColors);
	const plainResult = stripAnsi(result);
	t.true(plainResult.includes('const x = 5'));
});

test('parseMarkdown handles code blocks without language', t => {
	const text = '```\nPlain code\n```';
	const result = parseMarkdown(text, mockColors);
	t.true(result.includes('Plain code'));
});

// Edge case tests
test('parseMarkdown does not create bullet list from hyphen in middle of line', t => {
	const text = 'This is not - a list';
	const result = parseMarkdown(text, mockColors);
	t.false(result.includes('•'));
	t.true(result.includes('This is not - a list'));
});

test('parseMarkdown does not format asterisks in math expressions', t => {
	const text = 'Calculate 5 * 3 * 2 = 30';
	const result = parseMarkdown(text, mockColors);
	t.true(result.includes('5 * 3 * 2'));
});

test('parseMarkdown does not format asterisks in file globs', t => {
	const text = 'Match files with *.js or *.tsx patterns';
	const result = parseMarkdown(text, mockColors);
	t.true(result.includes('*.js'));
	t.true(result.includes('*.tsx'));
});

test('parseMarkdown does not create heading from hash in middle of line', t => {
	const text = 'This # is not a heading';
	const result = parseMarkdown(text, mockColors);
	t.true(result.includes('This # is not a heading'));
});

test('parseMarkdown preserves asterisks inside code blocks', t => {
	const text = '```javascript\nconst pattern = /\\*\\*/g;\n```';
	const result = parseMarkdown(text, mockColors);
	t.true(result.includes('/\\*\\*/g') || result.includes('**'));
});

test('parseMarkdown preserves markdown-like syntax inside inline code', t => {
	const text = 'Use `**bold**` and `*italic*` syntax';
	const result = parseMarkdown(text, mockColors);
	// Code content should be preserved (though formatting may be applied by chalk)
	t.false(result.includes('`**bold**`'));
	t.false(result.includes('`*italic*`'));
});

test('parseMarkdown does not format single asterisk surrounded by word chars', t => {
	const text = 'The pointer syntax is char*ptr or int*value';
	const result = parseMarkdown(text, mockColors);
	t.true(result.includes('char*ptr'));
	t.true(result.includes('int*value'));
});

// BR tag test
test('parseMarkdown converts <br> tags to newlines', t => {
	const text = 'Line one<br>Line two<br/>Line three<BR>Line four';
	const result = parseMarkdown(text, mockColors);
	const lines = result.split('\n');
	t.true(lines.length >= 4);
	t.true(result.includes('Line one'));
	t.true(result.includes('Line two'));
	t.false(result.includes('<br'));
});

// Spacing tests
test('parseMarkdown preserves spacing before bullet lists', t => {
	const text = `I can assist with tasks such as:

- First item
- Second item

Let me know what you'd like to work on.`;
	const result = parseMarkdown(text, mockColors);
	const lines = result.split('\n');
	const suchAsIndex = lines.findIndex(l => l.includes('I can assist'));
	const firstBulletIndex = lines.findIndex(l => l.includes('• First'));
	t.true(
		firstBulletIndex - suchAsIndex >= 2,
		'Should have blank line before list',
	);
});

// Mixed content tests
test('parseMarkdown handles mixed markdown features', t => {
	const text = `# Title

This is **bold** and *italic* text with \`code\`.

- List item 1
- List item 2

| Name | Value |
|------|-------|
| Test | 123   |`;
	const result = parseMarkdown(text, mockColors);
	t.true(result.includes('Title'));
	t.true(result.includes('bold'));
	t.true(result.includes('italic'));
	t.true(result.includes('•'));
	t.true(result.includes('Name'));
});

test('parseMarkdown handles plain text without markdown', t => {
	const text = 'This is just plain text without any formatting';
	const result = parseMarkdown(text, mockColors);
	t.true(result.includes('This is just plain text'));
});

test('parseMarkdown handles empty string', t => {
	const result = parseMarkdown('', mockColors);
	t.is(result, '');
});

// Placeholder restoration test
test('parseMarkdown restores inline code placeholders correctly', t => {
	const text = 'Use `npm install` and `npm start` commands';
	const result = parseMarkdown(text, mockColors);
	t.true(result.includes('npm install'));
	t.true(result.includes('npm start'));
	t.false(result.includes('__INLINE_CODE'));
	t.false(result.includes('_INLINE'));
	t.false(result.includes('CODE_'));
});
