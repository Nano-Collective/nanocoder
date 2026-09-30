import {stripVTControlCharacters} from 'node:util';
import test from 'ava';
import type {Colors} from '../types/markdown-parser';
import {parseMarkdownTable} from './table-parser';

console.log(`\ntable-parser.spec.ts`);

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

test('parseMarkdownTable handles simple two-column table', t => {
	const table = `| Name | Age |
|------|-----|
| John | 25  |
| Jane | 30  |`;
	const result = parseMarkdownTable(table, mockColors);
	t.true(result.includes('Name'));
	t.true(result.includes('Age'));
	t.true(result.includes('John'));
	t.true(result.includes('Jane'));
	t.true(result.includes('25'));
	t.true(result.includes('30'));
});

test('parseMarkdownTable handles table with varying cell lengths', t => {
	const table = `| Short | Very Long Column Name |
|-------|----------------------|
| A     | This is a much longer text |
| B     | Short |`;
	const result = parseMarkdownTable(table, mockColors);
	t.true(result.includes('Short'));
	t.true(result.includes('Very Long Column Name'));
	t.true(result.includes('This is a much longer text'));
});

test('parseMarkdownTable returns original text for invalid table', t => {
	const table = `Not a table at all`;
	const result = parseMarkdownTable(table, mockColors);
	t.is(result, table);
});

test('parseMarkdownTable returns original text for table without data rows', t => {
	const table = `| Name | Age |
|------|-----|`;
	const result = parseMarkdownTable(table, mockColors);
	t.is(result, table);
});

test('parseMarkdownTable handles table with empty cells', t => {
	const table = `| Name | Age |
|------|-----|
| John |     |
|      | 30  |`;
	const result = parseMarkdownTable(table, mockColors);
	t.true(result.includes('John'));
	t.true(result.includes('30'));
});

test('parseMarkdownTable normalizes column count', t => {
	const table = `| A | B | C |
|---|---|---|
| 1 | 2 |
| 3 | 4 | 5 | 6 |`;
	const result = parseMarkdownTable(table, mockColors);
	// Should handle mismatched columns gracefully
	t.true(typeof result === 'string');
	t.true(result.length > 0);
});

test('parseMarkdownTable strips markdown from cells', t => {
	const table = `| Command | Description |
|---------|-------------|
| \`npm install\` | Install **dependencies** |
| \`npm start\` | Start the *application* |`;
	const result = parseMarkdownTable(table, mockColors);
	// Should have plain text (backticks and formatting removed)
	t.true(result.includes('npm install'));
	t.true(result.includes('npm start'));
	t.true(result.includes('dependencies'));
	t.true(result.includes('application'));
	// Should NOT have markdown syntax
	t.false(result.includes('`npm install`'));
	t.false(result.includes('**dependencies**'));
	t.false(result.includes('*application*'));
});

test('parseMarkdownTable strips HTML from cells', t => {
	const table = `| Name | Description |
|------|-------------|
| Test | Text with <br> tag |
| Another | Text with <b>bold</b> |`;
	const result = parseMarkdownTable(table, mockColors);
	t.true(result.includes('Text with  tag')); // HTML tag removed
	t.true(result.includes('Text with bold')); // HTML tags removed
	t.false(result.includes('<br>'));
	t.false(result.includes('<b>'));
});

test('parseMarkdownTable handles links in cells', t => {
	const table = `| Name | Link |
|------|------|
| Google | [Visit](https://google.com) |`;
	const result = parseMarkdownTable(table, mockColors);
	t.true(result.includes('Visit'));
	t.false(result.includes('[Visit]'));
	t.false(result.includes('(https://google.com)'));
});

test('parseMarkdownTable handles alignment markers', t => {
	const table = `| Left | Center | Right |
|:-----|:------:|------:|
| A    | B      | C     |`;
	const result = parseMarkdownTable(table, mockColors);
	t.true(result.includes('Left'));
	t.true(result.includes('Center'));
	t.true(result.includes('Right'));
});

test('parseMarkdownTable creates table with borders', t => {
	const table = `| A | B |
|---|---|
| 1 | 2 |`;
	const result = parseMarkdownTable(table, mockColors);
	// Should contain table border characters
	t.true(result.includes('─') || result.includes('│'));
});

const wideTable = `| Name | License | Stars | Language | Updated | Maintainer | Bundle | Downloads |
|------|---------|-------|----------|---------|------------|--------|-----------|
| solidjs | MIT | 32000 | TypeScript | 2024-05-01 | Ryan Carniato | 7kb | 1200000 |`;

test('parseMarkdownTable keeps a many-column table within the terminal width', t => {
	const result = parseMarkdownTable(wideTable, mockColors, 80);
	const lines = stripVTControlCharacters(result).split('\n');
	t.true(lines.every(line => line.length <= 80));
	t.true(lines[0].startsWith('┌'));
});

test('parseMarkdownTable leaves a table that cannot fit as markdown', t => {
	t.is(parseMarkdownTable(wideTable, mockColors, 20), wideTable);
});
