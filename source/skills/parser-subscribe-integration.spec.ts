import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {parseCommandFile} from '@/custom-commands/parser';
import {parseCustomToolFile} from '@/custom-tools/parser';
import {parseSubagentMarkdown} from '@/subagents/markdown-parser';

console.log(`\nparser-subscribe-integration.spec.ts`);

async function withTempDir(fn: (dir: string) => Promise<void>) {
	const dir = await mkdtemp(join(tmpdir(), 'parser-subscribe-'));
	try {
		await fn(dir);
	} finally {
		await rm(dir, {recursive: true, force: true});
	}
}

test('subagent parser pulls subscribe from frontmatter', async t => {
	await withTempDir(async dir => {
		const filePath = join(dir, 'docs-agent.md');
		await writeFile(
			filePath,
			`---
name: docs-agent
description: Watch docs and refresh outputs when source changes.
subscribe:
  - kind: file.changed
    paths:
      - "docs/**"
    eventKinds:
      - add
      - change
---

You watch the docs directory for changes...
`,
		);

		const parsed = await parseSubagentMarkdown(filePath);
		t.is(parsed.config.name, 'docs-agent');
		t.deepEqual(parsed.subscribe, [
			{
				kind: 'file.changed',
				paths: ['docs/**'],
				eventKinds: ['add', 'change'],
			},
		]);
	});
});

test('subagent parser leaves subscribe undefined when absent', async t => {
	await withTempDir(async dir => {
		const filePath = join(dir, 'plain.md');
		await writeFile(
			filePath,
			`---
name: plain
description: Plain agent.
---

Body.
`,
		);

		const parsed = await parseSubagentMarkdown(filePath);
		t.is(parsed.subscribe, undefined);
	});
});

test('custom-tool parser pulls subscribe from frontmatter', async t => {
	await withTempDir(async dir => {
		const filePath = join(dir, 'gh_pr_diff.md');
		await writeFile(
			filePath,
			`---
name: gh_pr_diff
description: Fetch a PR diff.
approval: never
read_only: true
subscribe:
  - kind: schedule.cron
    cron: "*/15 * * * *"
---

echo hello
`,
		);

		const parsed = parseCustomToolFile(filePath);
		t.is(parsed.metadata.name, 'gh_pr_diff');
		t.deepEqual(parsed.subscribe, [
			{kind: 'schedule.cron', cron: '*/15 * * * *'},
		]);
	});
});

test('custom-tool parser rejects malformed subscribe by throwing parser error', async t => {
	await withTempDir(async dir => {
		const filePath = join(dir, 'broken_tool.md');
		await writeFile(
			filePath,
			`---
name: broken_tool
description: Has a bad subscribe block.
approval: never
read_only: true
subscribe:
  - kind: file.changed
    eventKinds:
      - rename
---

echo hi
`,
		);

		t.throws(() => parseCustomToolFile(filePath), {
			name: 'CustomToolParseError',
			message: /eventKinds must be an array/,
		});
	});
});

test('command parser pulls subscribe via the secondary YAML pass', async t => {
	await withTempDir(async dir => {
		const filePath = join(dir, 'weekly-report.md');
		await writeFile(
			filePath,
			`---
description: Monday morning summary.
subscribe:
  - kind: schedule.cron
    cron: "0 9 * * MON"
    confirm: true
---

Summarize last week's commits...
`,
		);

		const parsed = parseCommandFile(filePath);
		t.is(parsed.metadata.description, 'Monday morning summary.');
		t.deepEqual(parsed.subscribe, [
			{kind: 'schedule.cron', cron: '0 9 * * MON', confirm: true},
		]);
	});
});

test('command parser drops malformed subscribe but keeps the command loaded', async t => {
	await withTempDir(async dir => {
		const filePath = join(dir, 'noisy.md');
		await writeFile(
			filePath,
			`---
description: Has a bad subscribe block.
subscribe:
  - kind: unknown-kind
---

Body.
`,
		);

		const parsed = parseCommandFile(filePath);
		t.is(parsed.metadata.description, 'Has a bad subscribe block.');
		t.is(parsed.subscribe, undefined);
	});
});
