import { writeFileSync, rmSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import test from 'ava';
import { CustomCommandLoader } from './loader';

// Helper to create a valid custom command file
function createCommandFile(path: string, content: string) {
	const fullContent = `---
description: ${content}
---

${content}`;
	writeFileSync(path, fullContent, 'utf-8');
}

// Helper to create a unique test directory for each test
function createTestDir(testName: string): string {
	const dir = join(tmpdir(), `nanocoder-cmd-test-${Date.now()}-${testName}`);
	mkdirSync(dir, {recursive: true});
	return dir;
}

// Helper to clean up test directory
function cleanupTestDir(dir: string) {
	if (existsSync(dir)) {
		rmSync(dir, {recursive: true, force: true});
	}
}

test('CustomCommandLoader - constructor initializes with project root', t => {
	const testDir = createTestDir('constructor');
	t.teardown(() => cleanupTestDir(testDir));

	const loader = new CustomCommandLoader(testDir);
	t.truthy(loader);
});

test('CustomCommandLoader - constructor uses cwd when no path provided', t => {
	const loader = new CustomCommandLoader();
	t.truthy(loader);
});

test('CustomCommandLoader - hasCustomCommands returns false when no commands directory', t => {
	const testDir = createTestDir('has-no-commands');
	t.teardown(() => cleanupTestDir(testDir));

	const loader = new CustomCommandLoader(testDir);
	t.false(loader.hasCustomCommands());
});

test('CustomCommandLoader - hasCustomCommands returns true when commands directory exists', t => {
	const testDir = createTestDir('has-commands');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	mkdirSync(commandsDir, {recursive: true});

	const loader = new CustomCommandLoader(testDir);
	t.true(loader.hasCustomCommands());
});

test('CustomCommandLoader - getCommandsDirectory returns correct path', t => {
	const testDir = createTestDir('get-dir');
	t.teardown(() => cleanupTestDir(testDir));

	const loader = new CustomCommandLoader(testDir);
	const expectedPath = join(testDir, '.nanocoder', 'commands');
	t.is(loader.getCommandsDirectory(), expectedPath);
});

test('CustomCommandLoader - loadCommands with no commands directory', t => {
	const testDir = createTestDir('no-dir');
	t.teardown(() => cleanupTestDir(testDir));

	const loader = new CustomCommandLoader(testDir);
	t.notThrows(() => loader.loadCommands());

	const commands = loader.getAllCommands();
	t.is(commands.length, 0);
});

test('CustomCommandLoader - loadCommands loads single command', t => {
	const testDir = createTestDir('single-cmd');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	mkdirSync(commandsDir, {recursive: true});
	createCommandFile(join(commandsDir, 'test.md'), 'A test command');

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();

	const commands = loader.getAllCommands();
	t.is(commands.length, 1);
	t.is(commands[0].name, 'test');
});

test('CustomCommandLoader - loadCommands loads multiple commands', t => {
	const testDir = createTestDir('multi-cmd');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	mkdirSync(commandsDir, {recursive: true});
	createCommandFile(join(commandsDir, 'cmd1.md'), 'Command 1');
	createCommandFile(join(commandsDir, 'cmd2.md'), 'Command 2');
	createCommandFile(join(commandsDir, 'cmd3.md'), 'Command 3');

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();

	const commands = loader.getAllCommands();
	t.is(commands.length, 3);
});

test('CustomCommandLoader - loadCommands loads namespaced commands', t => {
	const testDir = createTestDir('namespace');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	const namespaceDir = join(commandsDir, 'git');
	mkdirSync(namespaceDir, {recursive: true});
	createCommandFile(join(namespaceDir, 'commit.md'), 'Git commit command');

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();

	const command = loader.getCommand('git:commit');
	t.truthy(command);
	t.is(command?.name, 'commit');
	t.is(command?.namespace, 'git');
	t.is(command?.fullName, 'git:commit');
});

test('CustomCommandLoader - getCommand retrieves command by name', t => {
	const testDir = createTestDir('get-cmd');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	mkdirSync(commandsDir, {recursive: true});
	createCommandFile(join(commandsDir, 'test.md'), 'Test command');

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();

	const command = loader.getCommand('test');
	t.truthy(command);
	t.is(command?.name, 'test');
});

test('CustomCommandLoader - getCommand returns undefined for non-existent command', t => {
	const testDir = createTestDir('get-nonexistent');
	t.teardown(() => cleanupTestDir(testDir));

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();

	const command = loader.getCommand('nonexistent');
	t.is(command, undefined);
});

test('CustomCommandLoader - getAllCommands returns array', t => {
	const testDir = createTestDir('get-all');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	mkdirSync(commandsDir, {recursive: true});
	createCommandFile(join(commandsDir, 'test.md'), 'Test command');

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();

	const commands = loader.getAllCommands();
	t.true(Array.isArray(commands));
	t.is(commands.length, 1);
});

test('CustomCommandLoader - getSuggestions returns matching commands', t => {
	const testDir = createTestDir('suggestions');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	mkdirSync(commandsDir, {recursive: true});
	createCommandFile(join(commandsDir, 'test1.md'), 'Test 1');
	createCommandFile(join(commandsDir, 'test2.md'), 'Test 2');
	createCommandFile(join(commandsDir, 'other.md'), 'Other');

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();

	const suggestions = loader.getSuggestions('test');

	t.true(suggestions.includes('test1'));
	t.true(suggestions.includes('test2'));
	t.false(suggestions.includes('other'));
});

test('CustomCommandLoader - getSuggestions is case insensitive', t => {
	const testDir = createTestDir('case-insensitive');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	mkdirSync(commandsDir, {recursive: true});
	createCommandFile(join(commandsDir, 'MyCommand.md'), 'My command');

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();

	const suggestionsLower = loader.getSuggestions('mycommand');
	const suggestionsUpper = loader.getSuggestions('MYCOMMAND');

	t.true(suggestionsLower.includes('MyCommand'));
	t.true(suggestionsUpper.includes('MyCommand'));
});

test('CustomCommandLoader - getSuggestions returns empty array when no matches', t => {
	const testDir = createTestDir('no-matches');
	t.teardown(() => cleanupTestDir(testDir));

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();

	const suggestions = loader.getSuggestions('nonexistent');
	t.deepEqual(suggestions, []);
});

test('CustomCommandLoader - loadCommands clears existing commands', t => {
	const testDir = createTestDir('clears');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	mkdirSync(commandsDir, {recursive: true});
	createCommandFile(join(commandsDir, 'test.md'), 'Test');

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();
	t.is(loader.getAllCommands().length, 1);

	// Reload
	loader.loadCommands();
	t.is(loader.getAllCommands().length, 1);
});

test('CustomCommandLoader - loadCommands handles invalid command files gracefully', t => {
	const testDir = createTestDir('invalid');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	mkdirSync(commandsDir, {recursive: true});

	// Create invalid file (no frontmatter)
	writeFileSync(join(commandsDir, 'invalid.md'), 'Just content without frontmatter', 'utf-8');

	// Create valid file
	createCommandFile(join(commandsDir, 'valid.md'), 'Valid command');

	const loader = new CustomCommandLoader(testDir);
	t.notThrows(() => loader.loadCommands());

	// Should still load the valid command
	const commands = loader.getAllCommands();
	t.true(commands.some(c => c.name === 'valid'));
});

test('CustomCommandLoader - handles deeply nested namespaces', t => {
	const testDir = createTestDir('nested');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	const deepDir = join(commandsDir, 'level1', 'level2', 'level3');
	mkdirSync(deepDir, {recursive: true});
	createCommandFile(join(deepDir, 'deep.md'), 'Deep command');

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();

	const command = loader.getCommand('level1:level2:level3:deep');
	t.truthy(command);
	t.is(command?.fullName, 'level1:level2:level3:deep');
});

test('CustomCommandLoader - ignores non-markdown files', t => {
	const testDir = createTestDir('ignore-non-md');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	mkdirSync(commandsDir, {recursive: true});
	createCommandFile(join(commandsDir, 'test.md'), 'Test command');
	writeFileSync(join(commandsDir, 'test.txt'), 'Not a command', 'utf-8');
	writeFileSync(join(commandsDir, 'test.js'), 'console.log("test");', 'utf-8');

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();

	// Should only load the .md file
	t.is(loader.getAllCommands().length, 1);
});

test('CustomCommandLoader - loadCommands clears aliases on reload', t => {
	const testDir = createTestDir('clear-aliases');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	mkdirSync(commandsDir, {recursive: true});
	createCommandFile(join(commandsDir, 'test.md'), 'Test');

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();
	t.is(loader.getAllCommands().length, 1);

	// Reload
	loader.loadCommands();
	t.is(loader.getAllCommands().length, 1);
});

// ============================================================================
// Directory-as-command
// ============================================================================

test('CustomCommandLoader - loads directory-as-command when dirname.md exists', t => {
	const testDir = createTestDir('dir-as-cmd');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	const apiDocsDir = join(commandsDir, 'api-docs');
	mkdirSync(apiDocsDir, {recursive: true});

	// Create command file matching directory name
	writeFileSync(
		join(apiDocsDir, 'api-docs.md'),
		`---
description: Generate API docs
tags: [api]
---
Generate API documentation.`,
		'utf-8',
	);

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();

	const command = loader.getCommand('api-docs');
	t.truthy(command);
	t.is(command?.name, 'api-docs');
	t.is(command?.metadata.description, 'Generate API docs');
	t.deepEqual(command?.metadata.tags, ['api']);
});

test('CustomCommandLoader - directory-as-command loads resources', t => {
	const testDir = createTestDir('dir-resources');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	const mySkillDir = join(commandsDir, 'my-skill');
	const resourcesDir = join(mySkillDir, 'resources');
	mkdirSync(resourcesDir, {recursive: true});

	writeFileSync(
		join(mySkillDir, 'my-skill.md'),
		`---
description: Skill with resources
resources: true
---
Do stuff.`,
		'utf-8',
	);
	writeFileSync(join(resourcesDir, 'template.yaml'), 'key: value', 'utf-8');
	writeFileSync(join(resourcesDir, 'helper.sh'), '#!/bin/bash\necho hi', 'utf-8');

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();

	const command = loader.getCommand('my-skill');
	t.truthy(command);
	t.truthy(command?.loadedResources);
	t.is(command?.loadedResources?.length, 2);

	const templateRes = command?.loadedResources?.find(
		r => r.name === 'template.yaml',
	);
	t.truthy(templateRes);
	t.is(templateRes?.type, 'config');

	const scriptRes = command?.loadedResources?.find(
		r => r.name === 'helper.sh',
	);
	t.truthy(scriptRes);
	t.is(scriptRes?.type, 'script');
});

test('CustomCommandLoader - directory-as-command falls back to namespace when no dirname.md', t => {
	const testDir = createTestDir('dir-namespace-fallback');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	const subDir = join(commandsDir, 'mygroup');
	mkdirSync(subDir, {recursive: true});

	// No mygroup.md inside mygroup/, so it should be treated as a namespace
	createCommandFile(join(subDir, 'sub-cmd.md'), 'A sub command');

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();

	const command = loader.getCommand('mygroup:sub-cmd');
	t.truthy(command);
	t.is(command?.namespace, 'mygroup');
});

// ============================================================================
// Auto-injectable commands
// ============================================================================

test('CustomCommandLoader - getAutoInjectableCommands returns commands with triggers', t => {
	const testDir = createTestDir('auto-inject-triggers');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	mkdirSync(commandsDir, {recursive: true});

	writeFileSync(
		join(commandsDir, 'auto.md'),
		`---
description: Auto-injectable
triggers: [generate api]
---
Auto content`,
		'utf-8',
	);
	createCommandFile(join(commandsDir, 'manual.md'), 'Manual only');

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();

	const autoInjectable = loader.getAutoInjectableCommands();
	t.is(autoInjectable.length, 1);
	t.is(autoInjectable[0]?.name, 'auto');
});

test('CustomCommandLoader - getAutoInjectableCommands returns commands with tags', t => {
	const testDir = createTestDir('auto-inject-tags');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	mkdirSync(commandsDir, {recursive: true});

	writeFileSync(
		join(commandsDir, 'tagged.md'),
		`---
description: Tagged command
tags: [testing]
---
Tagged content`,
		'utf-8',
	);

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();

	const autoInjectable = loader.getAutoInjectableCommands();
	t.is(autoInjectable.length, 1);
	t.is(autoInjectable[0]?.name, 'tagged');
});

test('CustomCommandLoader - getAutoInjectableCommands returns empty when no triggers or tags', t => {
	const testDir = createTestDir('auto-inject-none');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	mkdirSync(commandsDir, {recursive: true});
	createCommandFile(join(commandsDir, 'plain.md'), 'Plain command');

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();

	const autoInjectable = loader.getAutoInjectableCommands();
	t.is(autoInjectable.length, 0);
});

// ============================================================================
// Relevance scoring
// ============================================================================

test('CustomCommandLoader - findRelevantCommands matches by trigger', t => {
	const testDir = createTestDir('relevance-trigger');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	mkdirSync(commandsDir, {recursive: true});

	writeFileSync(
		join(commandsDir, 'api-cmd.md'),
		`---
description: API command
triggers: [api docs, openapi]
---
Generate API docs.`,
		'utf-8',
	);

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();

	const relevant = loader.findRelevantCommands('generate api docs please', [
		'read_file',
	]);
	t.is(relevant.length, 1);
	t.is(relevant[0]?.name, 'api-cmd');
});

test('CustomCommandLoader - findRelevantCommands matches by tag', t => {
	const testDir = createTestDir('relevance-tag');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	mkdirSync(commandsDir, {recursive: true});

	writeFileSync(
		join(commandsDir, 'test-cmd.md'),
		`---
description: Testing command
tags: [testing, quality]
triggers: [write tests]
---
Write unit tests.`,
		'utf-8',
	);

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();

	const relevant = loader.findRelevantCommands(
		'help with testing this module',
		[],
	);
	t.is(relevant.length, 1);
	t.is(relevant[0]?.name, 'test-cmd');
});

test('CustomCommandLoader - findRelevantCommands returns empty when no match', t => {
	const testDir = createTestDir('relevance-no-match');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	mkdirSync(commandsDir, {recursive: true});

	writeFileSync(
		join(commandsDir, 'api-cmd.md'),
		`---
description: API command
triggers: [api docs]
---
Generate API docs.`,
		'utf-8',
	);

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();

	const relevant = loader.findRelevantCommands(
		'fix the login bug',
		['read_file'],
	);
	t.is(relevant.length, 0);
});

// ============================================================================
// Source tracking
// ============================================================================

test('CustomCommandLoader - commands have source set to project', t => {
	const testDir = createTestDir('source-project');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	mkdirSync(commandsDir, {recursive: true});
	createCommandFile(join(commandsDir, 'test.md'), 'Test');

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();

	const command = loader.getCommand('test');
	t.is(command?.source, 'project');
});

test('CustomCommandLoader - commands have lastModified set', t => {
	const testDir = createTestDir('last-modified');
	t.teardown(() => cleanupTestDir(testDir));

	const commandsDir = join(testDir, '.nanocoder', 'commands');
	mkdirSync(commandsDir, {recursive: true});
	createCommandFile(join(commandsDir, 'test.md'), 'Test');

	const loader = new CustomCommandLoader(testDir);
	loader.loadCommands();

	const command = loader.getCommand('test');
	t.truthy(command?.lastModified);
	t.true(command!.lastModified instanceof Date);
});

