import test from 'ava';
import {parseSkillFrontmatter} from './skill-frontmatter';

// ============================================================================
// parseSkillFrontmatter - basic parsing
// ============================================================================

test('parseSkillFrontmatter returns null when name is missing', t => {
	const raw = `description: A skill
category: general`;
	t.is(parseSkillFrontmatter(raw, 'project:test'), null);
});

test('parseSkillFrontmatter returns null when description is missing', t => {
	const raw = `name: My Skill
category: general`;
	t.is(parseSkillFrontmatter(raw, 'project:test'), null);
});

test('parseSkillFrontmatter parses minimal valid frontmatter', t => {
	const raw = `name: Test Skill
description: Does something useful
category: docs`;
	const result = parseSkillFrontmatter(raw, 'project:my-skill');
	t.truthy(result);
	t.is(result!.id, 'project:my-skill');
	t.is(result!.name, 'Test Skill');
	t.is(result!.description, 'Does something useful');
	t.is(result!.category, 'docs');
});

test('parseSkillFrontmatter defaults category to general', t => {
	const raw = `name: Foo
description: Bar`;
	const result = parseSkillFrontmatter(raw, 'personal:foo');
	t.truthy(result);
	t.is(result!.category, 'general');
});

test('parseSkillFrontmatter parses allowed-tools array (inline)', t => {
	const raw = `name: Code Skill
description: Edit code
allowed-tools: [read_file, write_file, string_replace]`;
	const result = parseSkillFrontmatter(raw, 'project:code');
	t.truthy(result);
	t.deepEqual(result!.allowedTools, ['read_file', 'write_file', 'string_replace']);
});

test('parseSkillFrontmatter parses tags and triggers (dash list)', t => {
	const raw = `name: API Skill
description: API docs
category: docs
tags:
  - api
  - rest
triggers:
  - api docs
  - openapi`;
	const result = parseSkillFrontmatter(raw, 'project:api');
	t.truthy(result);
	t.deepEqual(result!.tags, ['api', 'rest']);
	t.deepEqual(result!.triggers, ['api docs', 'openapi']);
});

test('parseSkillFrontmatter parses version and author', t => {
	const raw = `name: Versioned
description: Has version
version: 2.0.0
author: Dev Team`;
	const result = parseSkillFrontmatter(raw, 'project:v');
	t.truthy(result);
	t.is(result!.version, '2.0.0');
	t.is(result!.author, 'Dev Team');
});

test('parseSkillFrontmatter parses estimated-tokens as number', t => {
	const raw = `name: Big
description: Big skill
estimated-tokens: 1500`;
	const result = parseSkillFrontmatter(raw, 'project:big');
	t.truthy(result);
	t.is(result!.estimatedTokens, 1500);
});

test('parseSkillFrontmatter parses examples and references', t => {
	const raw = `name: With Examples
description: Examples here
examples:
  - First example
  - Second example
references:
  - doc1.md
  - doc2.md`;
	const result = parseSkillFrontmatter(raw, 'project:ex');
	t.truthy(result);
	t.deepEqual(result!.examples, ['First example', 'Second example']);
	t.deepEqual(result!.references, ['doc1.md', 'doc2.md']);
});

test('parseSkillFrontmatter ignores comments and empty lines', t => {
	const raw = `# comment
name: Clean
# another
description: Clean skill
category: general`;
	const result = parseSkillFrontmatter(raw, 'project:clean');
	t.truthy(result);
	t.is(result!.name, 'Clean');
	t.is(result!.description, 'Clean skill');
});
