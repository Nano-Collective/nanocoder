import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import test from 'ava';
import type React from 'react';
import { renderWithTheme } from '@/test-utils/render-with-theme';
import { clearReadTracker, markFileSeen } from '@/utils/read-tracker';
import { syntaxIslandEditTool } from './syntax-island-edit';

let testDir: string;

test.beforeEach(async () => {
	testDir = await mkdtemp(join(process.cwd(), '.syntax-island-test-'));
	clearReadTracker();
});

test.afterEach(async () => {
	if (testDir) {
		await rm(testDir, { recursive: true, force: true });
	}
});

async function createTestFile(
	filename: string,
	content: string,
): Promise<string> {
	const filePath = join(testDir, filename);
	await writeFile(filePath, content, 'utf-8');
	return filePath;
}

function projectRelativePath(filePath: string): string {
	return relative(process.cwd(), filePath);
}

// biome-ignore lint/suspicious/noExplicitAny: tool execute test wrapper
async function executeIslandEdit(args: any): Promise<string> {
	return await (syntaxIslandEditTool.tool as any).execute(args, {
		toolCallId: 'test',
		messages: [],
	});
}

test('syntaxIslandEditTool has expected metadata', (t) => {
	t.is(syntaxIslandEditTool.name, 'syntax_island_edit');
	t.truthy(syntaxIslandEditTool.tool.description);
	t.is(typeof syntaxIslandEditTool.tool.execute, 'function');
});

test('syntax_island_edit edits target function while preserving surrounding code', async (t) => {
	const initialContent = `import { log } from './log';

export function calculate(val: number): number {
	return val * 2;
}

export function untouched(): string {
	return 'clean';
}
`;
	const filePath = await createTestFile('math.ts', initialContent);
	const relPath = projectRelativePath(filePath);
	markFileSeen(filePath);

	const result = await executeIslandEdit({
		path: relPath,
		symbol: 'calculate',
		new_body: 'return val * 10;',
	});

	t.true(result.includes("Successfully updated syntax island 'calculate'"));

	const updatedOnDisk = await readFile(filePath, 'utf-8');
	t.true(updatedOnDisk.includes('return val * 10;'));
	t.true(updatedOnDisk.includes("import { log } from './log';"));
	t.true(updatedOnDisk.includes('export function untouched(): string {'));
});

test('syntax_island_edit validator rejects unread file', async (t) => {
	const filePath = await createTestFile('unread.ts', 'function a() {}');
	const relPath = projectRelativePath(filePath);

	const validation = await syntaxIslandEditTool.validator!({
		path: relPath,
		symbol: 'a',
		new_body: 'return true;',
	});

	t.false(validation.valid);
	t.true(validation.error?.includes('must be read before editing'));
});

test('syntax_island_edit formatter renders preview and result', async (t) => {
	const filePath = await createTestFile(
		'component.tsx',
		'export function App() { return <div />; }',
	);
	const relPath = projectRelativePath(filePath);
	markFileSeen(filePath);

	const previewEl = await (syntaxIslandEditTool.formatter as any)(
		{
			path: relPath,
			symbol: 'App',
			new_body: 'return <span>Updated</span>;',
			description: 'Update App UI',
		},
		undefined,
	);

	const { lastFrame: previewFrame } = renderWithTheme(previewEl as React.ReactElement);
	t.true(previewFrame()?.includes('Target:'));
	t.true(previewFrame()?.includes('App'));

	const resultEl = await (syntaxIslandEditTool.formatter as any)(
		{
			path: relPath,
			symbol: 'App',
			new_body: 'return <span>Updated</span>;',
		},
		'Successfully updated syntax island',
	);
	const { lastFrame: resultFrame } = renderWithTheme(resultEl as React.ReactElement);
	t.true(resultFrame()?.includes('Successfully updated syntax island'));
});
