import test from 'ava';
import {writeFile, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
	extractBody,
	extractFrontmatter,
	parseSubagentMarkdown,
	validateFrontmatter,
} from './markdown-parser.js';

console.log('\nmarkdown-parser.spec.ts');

test.serial('extractFrontmatter - parses valid YAML frontmatter', t => {
	const content = `---
name: test-agent
description: A test agent
model: haiku
tools: [Read, Grep]
---
Some body content`;

	const frontmatter = extractFrontmatter(content);

	t.is(frontmatter.name, 'test-agent');
	t.is(frontmatter.description, 'A test agent');
	t.is(frontmatter.model, 'haiku');
	t.deepEqual(frontmatter.tools, ['Read', 'Grep']);
});

test.serial('extractFrontmatter - throws on missing frontmatter', t => {
	const content = `No frontmatter here`;

	t.throws(
		() => extractFrontmatter(content),
		{message: /No YAML frontmatter found/},
	);
});

test.serial('extractBody - extracts body content', t => {
	const content = `---
name: test
---
This is the body content`;

	const body = extractBody(content);

	t.is(body, 'This is the body content');
});

test.serial('extractBody - handles empty body', t => {
	const content = `---
name: test
---`;

	const body = extractBody(content);

	t.is(body, '');
});

test.serial('validateFrontmatter - accepts valid frontmatter', t => {
	const frontmatter = {
		name: 'test',
		description: 'A test agent',
		model: 'haiku',
		tools: ['Read'],
	};

	const result = validateFrontmatter(frontmatter);

	t.deepEqual(result, {valid: true});
});

test.serial('validateFrontmatter - rejects missing name', t => {
	const frontmatter = {
		description: 'A test agent',
	};

	const result = validateFrontmatter(frontmatter);

	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /name is required/);
	}
});

test.serial('validateFrontmatter - rejects missing description', t => {
	const frontmatter = {
		name: 'test',
	};

	const result = validateFrontmatter(frontmatter);

	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /description is required/);
	}
});

test.serial('validateFrontmatter - rejects non-array tools', t => {
	const frontmatter = {
		name: 'test',
		description: 'A test agent',
		tools: 'not-an-array',
	};

	const result = validateFrontmatter(frontmatter);

	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /tools must be an array/);
	}
});

test.serial('validateFrontmatter - rejects non-array disallowedTools', t => {
	const frontmatter = {
		name: 'test',
		description: 'A test agent',
		disallowedTools: 42,
	};

	const result = validateFrontmatter(frontmatter);

	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /disallowedTools must be an array/);
	}
});

test.serial('validateFrontmatter - rejects empty model', t => {
	const frontmatter = {
		name: 'test',
		description: 'A test agent',
		model: '',
	};

	const result = validateFrontmatter(frontmatter);

	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /model must be a non-empty string/);
	}
});

test.serial('validateFrontmatter - accepts model ID string', t => {
	const frontmatter = {
		name: 'test',
		description: 'A test agent',
		model: 'claude-3-5-haiku-20241022',
	};

	const result = validateFrontmatter(frontmatter);
	t.deepEqual(result, {valid: true});
});

test.serial('parseSubagentMarkdown - parses complete agent file', async t => {
	const tmpPath = join(tmpdir(), 'test-agent.md');
	const content = `---
name: test-agent
description: A test agent for parsing
model: sonnet
tools: [Read]
disallowedTools: [Write]
---
You are a test agent. Do your best!`;

	await writeFile(tmpPath, content, 'utf-8');

	try {
		const result = await parseSubagentMarkdown(tmpPath);

		t.is(result.config.name, 'test-agent');
		t.is(result.config.description, 'A test agent for parsing');
		t.is(result.config.model, 'sonnet');
		t.deepEqual(result.config.tools, ['Read']);
		t.deepEqual(result.config.disallowedTools, ['Write']);
		t.is(result.config.systemPrompt, 'You are a test agent. Do your best!');
		t.is(result.filePath, tmpPath);
		t.is(result.priority, 1); // Default priority
	} finally {
		await unlink(tmpPath);
	}
});
