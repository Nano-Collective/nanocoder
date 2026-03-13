import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	parseCommandFile,
	substituteTemplateVariables,
} from './parser';
import type {CustomCommandMetadata} from '@/types/index';

console.log('\nparser.spec.ts');

// Test directory setup
let testDir: string;

test.before(() => {
	testDir = join(tmpdir(), `nanocoder-parser-test-${Date.now()}`);
	mkdirSync(testDir, {recursive: true});
});

test.after.always(() => {
	if (testDir) {
		rmSync(testDir, {recursive: true, force: true});
	}
});

// ============================================================================
// parseCommandFile Tests
// ============================================================================

test('parseCommandFile parses file with YAML frontmatter', t => {
	const filePath = join(testDir, 'test-command.md');
	const content = `---
description: Test command
aliases: [t, test]
parameters: [file, line]
---
This is the command content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.deepEqual(result.metadata, {
		description: 'Test command',
		aliases: ['t', 'test'],
		parameters: ['file', 'line'],
	});
	t.is(result.content, 'This is the command content');
});

test('parseCommandFile handles file without frontmatter', t => {
	const filePath = join(testDir, 'simple-command.md');
	const content = 'Just content, no frontmatter';

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.deepEqual(result.metadata, {});
	t.is(result.content, 'Just content, no frontmatter');
});

test('parseCommandFile handles file with empty frontmatter', t => {
	const filePath = join(testDir, 'empty-frontmatter.md');
	const content = `---
---
Just content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	// When frontmatter is empty, the --- markers become part of content
	t.deepEqual(result.metadata, {});
	t.true(result.content.includes('Just content'));
});

test('parseCommandFile handles frontmatter parsing errors gracefully', t => {
	const filePath = join(testDir, 'invalid-frontmatter.md');
	const content = `---
description: [[[
invalid
syntax
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	// Should not throw, should treat entire file as content
	const result = parseCommandFile(filePath);

	t.is(result.content.includes('Content'), true);
});

// ============================================================================
// parseEnhancedFrontmatter Tests - Basic Key-Value Pairs
// ============================================================================

test('parseEnhancedFrontmatter parses single key-value pair', t => {
	const filePath = join(testDir, 'single-key.md');
	const content = `---
description: Simple command
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.is(result.metadata.description, 'Simple command');
});

test('parseEnhancedFrontmatter parses description with quotes', t => {
	const filePath = join(testDir, 'quoted-desc.md');
	const content = `---
description: "A command with quotes"
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.is(result.metadata.description, 'A command with quotes');
});

test('parseEnhancedFrontmatter parses description with single quotes', t => {
	const filePath = join(testDir, 'single-quoted-desc.md');
	const content = `---
description: 'Another quoted description'
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.is(result.metadata.description, 'Another quoted description');
});

test('parseEnhancedFrontmatter skips comments', t => {
	const filePath = join(testDir, 'with-comments.md');
	const content = `---
# This is a comment
description: Command
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.is(result.metadata.description, 'Command');
});

test('parseEnhancedFrontmatter skips empty lines', t => {
	const filePath = join(testDir, 'with-empty-lines.md');
	const content = `---
description: Command


aliases: [t]
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.is(result.metadata.description, 'Command');
	t.deepEqual(result.metadata.aliases, ['t']);
});

// ============================================================================
// JSON-style Arrays Tests
// ============================================================================

test('parseEnhancedFrontmatter parses JSON-style aliases array', t => {
	const filePath = join(testDir, 'json-aliases.md');
	const content = `---
aliases: [t, test, cmd]
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.deepEqual(result.metadata.aliases, ['t', 'test', 'cmd']);
});

test('parseEnhancedFrontmatter parses JSON-style parameters array', t => {
	const filePath = join(testDir, 'json-params.md');
	const content = `---
parameters: [file, line, column]
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.deepEqual(result.metadata.parameters, ['file', 'line', 'column']);
});

test('parseEnhancedFrontmatter parses arrays with quoted strings', t => {
	const filePath = join(testDir, 'quoted-array.md');
	const content = `---
aliases: ["alias one", "alias two", "alias three"]
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.deepEqual(result.metadata.aliases, ['alias one', 'alias two', 'alias three']);
});

test('parseEnhancedFrontmatter handles empty JSON array', t => {
	const filePath = join(testDir, 'empty-array.md');
	const content = `---
aliases: []
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.deepEqual(result.metadata.aliases, []);
});

test('parseEnhancedFrontmatter handles JSON array with spaces', t => {
	const filePath = join(testDir, 'spaced-array.md');
	const content = `---
aliases: [ alias1 , alias2 , alias3 ]
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.deepEqual(result.metadata.aliases, ['alias1', 'alias2', 'alias3']);
});

// ============================================================================
// YAML Dash Syntax Arrays Tests
// ============================================================================

test('parseEnhancedFrontmatter parses YAML dash aliases', t => {
	const filePath = join(testDir, 'yaml-dash-aliases.md');
	const content = `---
aliases:
  - t
  - test
  - cmd
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.deepEqual(result.metadata.aliases, ['t', 'test', 'cmd']);
});

test('parseEnhancedFrontmatter parses YAML dash parameters', t => {
	const filePath = join(testDir, 'yaml-dash-params.md');
	const content = `---
parameters:
  - file
  - line
  - column
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.deepEqual(result.metadata.parameters, ['file', 'line', 'column']);
});

test('parseEnhancedFrontmatter parses mixed dash and quoted values', t => {
	const filePath = join(testDir, 'mixed-dash.md');
	const content = `---
aliases:
  - alias one
  - 'alias two'
  - "alias three"
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.deepEqual(result.metadata.aliases, ['alias one', 'alias two', 'alias three']);
});

test('parseEnhancedFrontmatter handles single value as array item', t => {
	const filePath = join(testDir, 'single-value.md');
	const content = `---
aliases: t
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.deepEqual(result.metadata.aliases, ['t']);
});

test('parseEnhancedFrontmatter handles single quoted value as array item', t => {
	const filePath = join(testDir, 'single-quoted-value.md');
	const content = `---
aliases: 'test alias'
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.deepEqual(result.metadata.aliases, ['test alias']);
});

// ============================================================================
// Multi-line String Tests
// ============================================================================

test('parseEnhancedFrontmatter parses multi-line string with pipe', t => {
	const filePath = join(testDir, 'multiline-pipe.md');
	const content = `---
description: |
  This is a multi-line
  description that spans
  multiple lines
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.is(result.metadata.description, 'This is a multi-line\ndescription that spans\nmultiple lines');
});

test('parseEnhancedFrontmatter parses multi-line string with greater-than', t => {
	const filePath = join(testDir, 'multiline-gt.md');
	const content = `---
description: >
  This is a folded
  multi-line string
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.is(result.metadata.description, 'This is a folded\nmulti-line string');
});

test('parseEnhancedFrontmatter handles multi-line with extra indentation', t => {
	const filePath = join(testDir, 'multiline-indent.md');
	const content = `---
description: |
    Line with extra indentation
    Another indented line
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	// Should strip the common indentation
	t.is(result.metadata.description, 'Line with extra indentation\nAnother indented line');
});

test('parseEnhancedFrontmatter handles multi-line ending at EOF', t => {
	const filePath = join(testDir, 'multiline-eof.md');
	const content = `---
description: |
  Multi-line content at end of file
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.is(result.metadata.description, 'Multi-line content at end of file');
});

test('parseEnhancedFrontmatter handles multi-line with blank lines', t => {
	const filePath = join(testDir, 'multiline-blank.md');
	const content = `---
description: |
  Line 1

  Line 2
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	// Blank lines within multi-line blocks are preserved by the parser
	// The regex needs to match literal newlines in the string
	t.true(result.metadata.description!.includes('Line 1'));
	t.true(result.metadata.description!.includes('Line 2'));
});

// ============================================================================
// Complex Combined Frontmatter Tests
// ============================================================================

test('parseEnhancedFrontmatter handles all metadata fields', t => {
	const filePath = join(testDir, 'all-fields.md');
	const content = `---
description: Full command
aliases: [f, full]
parameters: [input, output]
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.deepEqual(result.metadata, {
		description: 'Full command',
		aliases: ['f', 'full'],
		parameters: ['input', 'output'],
	});
});

test('parseEnhancedFrontmatter handles JSON arrays with multi-line', t => {
	const filePath = join(testDir, 'mixed-multi-line.md');
	const content = `---
description: |
  Multi-line description
aliases: [a, b]
parameters:
  - p1
  - p2
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.is(result.metadata.description, 'Multi-line description');
	t.deepEqual(result.metadata.aliases, ['a', 'b']);
	t.deepEqual(result.metadata.parameters, ['p1', 'p2']);
});

test('parseEnhancedFrontmatter handles dash syntax after key without value', t => {
	const filePath = join(testDir, 'dash-after-key.md');
	const content = `---
aliases:
  - first
  - second
description: Command with dash aliases
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.deepEqual(result.metadata.aliases, ['first', 'second']);
	t.is(result.metadata.description, 'Command with dash aliases');
});

test('parseEnhancedFrontmatter preserves array order', t => {
	const filePath = join(testDir, 'array-order.md');
	const content = `---
aliases:
  - z-last
  - a-first
  - m-middle
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.deepEqual(result.metadata.aliases, ['z-last', 'a-first', 'm-middle']);
});

// ============================================================================
// substituteTemplateVariables Tests
// ============================================================================

test('substituteTemplateVariables replaces single variable', t => {
	const content = 'Hello {{name}}!';
	const result = substituteTemplateVariables(content, {name: 'World'});

	t.is(result, 'Hello World!');
});

test('substituteTemplateVariables replaces multiple variables', t => {
	const content = '{{greeting}} {{name}}!';
	const result = substituteTemplateVariables(content, {
		greeting: 'Hello',
		name: 'World',
	});

	t.is(result, 'Hello World!');
});

test('substituteTemplateVariables replaces multiple occurrences', t => {
	const content = '{{name}} said {{name}} says hi';
	const result = substituteTemplateVariables(content, {name: 'Alice'});

	t.is(result, 'Alice said Alice says hi');
});

test('substituteTemplateVariables handles variable with spaces', t => {
	const content = 'Value: {{ var_name }}';
	const result = substituteTemplateVariables(content, {var_name: 'test'});

	t.is(result, 'Value: test');
});

test('substituteTemplateVariables handles missing variables', t => {
	const content = 'Hello {{name}} and {{missing}}';
	const result = substituteTemplateVariables(content, {name: 'World'});

	t.is(result, 'Hello World and {{missing}}');
});

test('substituteTemplateVariables handles empty variables object', t => {
	const content = 'Hello {{name}}!';
	const result = substituteTemplateVariables(content, {});

	t.is(result, 'Hello {{name}}!');
});

test('substituteTemplateVariables handles variables with special chars', t => {
	const content = 'Path: {{path}}';
	const result = substituteTemplateVariables(content, {
		path: '/home/user/file.txt',
	});

	t.is(result, 'Path: /home/user/file.txt');
});

test('substituteTemplateVariables handles newlines in values', t => {
	const content = 'Before\n{{text}}\nAfter';
	const result = substituteTemplateVariables(content, {
		text: 'multi\nline\nvalue',
	});

	t.is(result, 'Before\nmulti\nline\nvalue\nAfter');
});

test('substituteTemplateVariables handles complex substitution patterns', t => {
	const content = `
# {{title}}

## Description
{{description}}

## Usage
\`\`\`
{{command}}
\`\`\`
`;

	const result = substituteTemplateVariables(content, {
		title: 'My Command',
		description: 'A great command',
		command: 'my-command --help',
	});

	t.true(result.includes('# My Command'));
	t.true(result.includes('A great command'));
	t.true(result.includes('my-command --help'));
});

test('substituteTemplateVariables handles variable names with underscores', t => {
	const content = '{{first_name}} {{last_name}}';
	const result = substituteTemplateVariables(content, {
		first_name: 'John',
		last_name: 'Doe',
	});

	t.is(result, 'John Doe');
});

test('substituteTemplateVariables handles empty replacement values', t => {
	const content = 'Start: {{value}}, End';
	const result = substituteTemplateVariables(content, {value: ''});

	t.is(result, 'Start: , End');
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

test('parseCommandFile handles file with only frontmatter', t => {
	const filePath = join(testDir, 'only-frontmatter.md');
	const content = `---
description: Only metadata
---
`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	// When file has only frontmatter with no content after ---, the regex
	// doesn't match because group 2 (content) requires at least an empty string match
	// So the entire file is treated as content with empty metadata
	t.deepEqual(result.metadata, {});
	t.true(result.content.includes('Only metadata'));
});

test('parseCommandFile handles file with BOM', t => {
	const filePath = join(testDir, 'with-bom.md');
	const bom = '\uFEFF';
	const content = `${bom}---
description: Command
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	// BOM character prevents frontmatter parsing, so entire file is content
	// The metadata will be empty since no frontmatter was detected
	t.true(result.content.includes('Command'));
});

test('parseCommandFile handles very long description', t => {
	const filePath = join(testDir, 'long-desc.md');
	const longDesc = 'A'.repeat(500);
	const content = `---
description: ${longDesc}
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.is(result.metadata.description, longDesc);
});

test('parseCommandFile handles special characters in values', t => {
	const filePath = join(testDir, 'special-chars.md');
	const content = `---
description: "Command with $pecial chars!"
aliases: ["@alias", "#tag"]
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.is(result.metadata.description, 'Command with $pecial chars!');
	t.deepEqual(result.metadata.aliases, ['@alias', '#tag']);
});

test('parseEnhancedFrontmatter handles key with colon in value', t => {
	const filePath = join(testDir, 'colon-in-value.md');
	const content = `---
description: Time: 10:30
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.is(result.metadata.description, 'Time: 10:30');
});

// ============================================================================
// Skill-like Frontmatter Keys (tags, triggers, etc.)
// ============================================================================

test('parseEnhancedFrontmatter parses tags as JSON array', t => {
	const filePath = join(testDir, 'tags-json.md');
	const content = `---
description: Tagged command
tags: [api, openapi, rest]
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.deepEqual(result.metadata.tags, ['api', 'openapi', 'rest']);
});

test('parseEnhancedFrontmatter parses tags as YAML dash syntax', t => {
	const filePath = join(testDir, 'tags-dash.md');
	const content = `---
description: Tagged command
tags:
  - api
  - openapi
  - rest
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.deepEqual(result.metadata.tags, ['api', 'openapi', 'rest']);
});

test('parseEnhancedFrontmatter parses triggers', t => {
	const filePath = join(testDir, 'triggers.md');
	const content = `---
description: Triggered command
triggers: [api docs, openapi]
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.deepEqual(result.metadata.triggers, ['api docs', 'openapi']);
});

test('parseEnhancedFrontmatter parses estimated-tokens as number', t => {
	const filePath = join(testDir, 'estimated-tokens.md');
	const content = `---
description: Token-estimated command
estimated-tokens: 2500
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.is(result.metadata.estimatedTokens, 2500);
});

test('parseEnhancedFrontmatter parses resources boolean', t => {
	const filePath = join(testDir, 'resources-bool.md');
	const content = `---
description: Command with resources
resources: true
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.is(result.metadata.resources, true);
});

test('parseEnhancedFrontmatter parses resources false', t => {
	const filePath = join(testDir, 'resources-false.md');
	const content = `---
description: Command without resources
resources: false
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.is(result.metadata.resources, false);
});

test('parseEnhancedFrontmatter parses category', t => {
	const filePath = join(testDir, 'category.md');
	const content = `---
description: Categorized command
category: code-generation
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.is(result.metadata.category, 'code-generation');
});

test('parseEnhancedFrontmatter parses version and author', t => {
	const filePath = join(testDir, 'version-author.md');
	const content = `---
description: Versioned command
version: 2.1.0
author: Jane Doe
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.is(result.metadata.version, '2.1.0');
	t.is(result.metadata.author, 'Jane Doe');
});

test('parseEnhancedFrontmatter parses examples array', t => {
	const filePath = join(testDir, 'examples.md');
	const content = `---
description: Command with examples
examples:
  - Generate an API spec for user service
  - Create REST docs from code
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.deepEqual(result.metadata.examples, [
		'Generate an API spec for user service',
		'Create REST docs from code',
	]);
});

test('parseEnhancedFrontmatter parses references and dependencies', t => {
	const filePath = join(testDir, 'refs-deps.md');
	const content = `---
description: Command with refs and deps
references: [https://example.com/docs, https://example.com/api]
dependencies: [openapi-gen, yaml-parser]
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.deepEqual(result.metadata.references, [
		'https://example.com/docs',
		'https://example.com/api',
	]);
	t.deepEqual(result.metadata.dependencies, ['openapi-gen', 'yaml-parser']);
});

test('parseEnhancedFrontmatter handles full unified command format', t => {
	const filePath = join(testDir, 'unified-full.md');
	const content = `---
description: Generate OpenAPI specs from code
aliases: [api-gen]
parameters: [format]
tags: [api, openapi, rest]
triggers: [api docs, openapi]
estimated-tokens: 2500
resources: true
category: code-generation
version: 1.0.0
author: Nanocoder Team
examples:
  - Generate API spec for user service
  - Create REST docs
references: [https://openapi.org]
dependencies: [yaml-parser]
---
Generate an OpenAPI spec in {{format}} format.`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.is(result.metadata.description, 'Generate OpenAPI specs from code');
	t.deepEqual(result.metadata.aliases, ['api-gen']);
	t.deepEqual(result.metadata.parameters, ['format']);
	t.deepEqual(result.metadata.tags, ['api', 'openapi', 'rest']);
	t.deepEqual(result.metadata.triggers, ['api docs', 'openapi']);
	t.is(result.metadata.estimatedTokens, 2500);
	t.is(result.metadata.resources, true);
	t.is(result.metadata.category, 'code-generation');
	t.is(result.metadata.version, '1.0.0');
	t.is(result.metadata.author, 'Nanocoder Team');
	t.deepEqual(result.metadata.examples, [
		'Generate API spec for user service',
		'Create REST docs',
	]);
	t.deepEqual(result.metadata.references, ['https://openapi.org']);
	t.deepEqual(result.metadata.dependencies, ['yaml-parser']);
	t.is(result.content, 'Generate an OpenAPI spec in {{format}} format.');
});

test('parseEnhancedFrontmatter handles quoted value with colon', t => {
	const filePath = join(testDir, 'quoted-colon.md');
	const content = `---
description: "Command with: colon"
tags: ["tag:one", "tag:two"]
---
Content`;

	writeFileSync(filePath, content, 'utf-8');

	const result = parseCommandFile(filePath);

	t.is(result.metadata.description, 'Command with: colon');
	t.deepEqual(result.metadata.tags, ['tag:one', 'tag:two']);
});
