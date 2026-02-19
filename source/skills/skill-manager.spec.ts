import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import type {ToolManager} from '@/tools/tool-manager';
import {SkillManager} from './skill-manager';

const SKILL_FILE = 'SKILL.md';
const RESOURCES_DIR = 'resources';

let testDir: string;
let originalCwd: typeof process.cwd;

test.before(() => {
	testDir = join(tmpdir(), `nanocoder-skill-manager-${Date.now()}`);
	mkdirSync(testDir, {recursive: true});
	originalCwd = process.cwd;
});

test.after.always(() => {
	process.cwd = originalCwd;
	if (testDir) {
		rmSync(testDir, {recursive: true, force: true});
	}
});

function createMockToolManager(
	toolNames: string[] = ['read_file', 'write_file'],
): ToolManager {
	return {
		getToolNames: () => toolNames,
	} as unknown as ToolManager;
}

function writeSkill(
	skillDir: string,
	opts: {
		name: string;
		description: string;
		category?: string;
		triggers?: string[];
		body?: string;
	},
): void {
	mkdirSync(skillDir, {recursive: true});
	const triggersYaml = opts.triggers
		? `\ntriggers:\n${opts.triggers.map(t => `  - ${t}`).join('\n')}`
		: '';
	const content = `---
name: ${opts.name}
description: ${opts.description}
category: ${opts.category ?? 'general'}
version: 1.0.0${triggersYaml}
---
${opts.body ?? '# Instructions\n\nUse this skill.'}`;
	writeFileSync(join(skillDir, SKILL_FILE), content, 'utf-8');
}

// ============================================================================
// SkillManager - initialize and getAvailableSkills
// ============================================================================

test('SkillManager getAvailableSkills returns empty before initialize', t => {
	const mockTm = createMockToolManager();
	const manager = new SkillManager(mockTm);
	t.is(manager.getAvailableSkills().length, 0);
});

test('SkillManager initialize and getAvailableSkills finds project skills', async t => {
	const skillsRoot = join(testDir, '.nanocoder', 'skills', 'test-skill');
	writeSkill(skillsRoot, {
		name: 'Test Skill',
		description: 'A test skill for unit tests',
		category: 'testing',
	});

	process.cwd = () => testDir;
	const mockTm = createMockToolManager();
	const manager = new SkillManager(mockTm);
	await manager.initialize();

	const available = manager.getAvailableSkills();
	const projectSkills = available.filter(m => m.id?.startsWith('project:'));
	t.true(projectSkills.length >= 1);
	const testSkill = projectSkills.find(m => m.name === 'Test Skill');
	t.truthy(testSkill);
	t.is(testSkill!.description, 'A test skill for unit tests');
});

test('SkillManager loadSkill returns null for unknown id', async t => {
	process.cwd = () => testDir;
	const mockTm = createMockToolManager();
	const manager = new SkillManager(mockTm);
	await manager.initialize();

	const skill = await manager.loadSkill('project:nonexistent');
	t.is(skill, null);
});

test('SkillManager loadSkill returns full skill with content and resources', async t => {
	const skillDir = join(testDir, '.nanocoder', 'skills', 'full-skill');
	const resourcesDir = join(skillDir, RESOURCES_DIR);
	mkdirSync(resourcesDir, {recursive: true});
	writeSkill(skillDir, {
		name: 'Full Skill',
		description: 'Skill with resources',
		body: 'Do the thing.\n\nStep 1. Step 2.',
	});
	writeFileSync(join(resourcesDir, 'readme.md'), '# Readme', 'utf-8');
	writeFileSync(join(resourcesDir, 'config.json'), '{}', 'utf-8');

	process.cwd = () => testDir;
	const mockTm = createMockToolManager();
	const manager = new SkillManager(mockTm);
	await manager.initialize();

	const skill = await manager.loadSkill('project:full-skill');
	t.truthy(skill);
	t.is(skill!.name, 'Full Skill');
	t.is(skill!.version, '1.0.0');
	t.truthy(skill!.content);
	t.true(skill!.content!.instructions.includes('Do the thing'));
	t.is(skill!.resources?.length, 2);
});

test('SkillManager loadSkill returns cached skill on second call', async t => {
	const skillDir = join(testDir, '.nanocoder', 'skills', 'cache-me');
	writeSkill(skillDir, {name: 'Cache Me', description: 'For cache test'});

	process.cwd = () => testDir;
	const mockTm = createMockToolManager();
	const manager = new SkillManager(mockTm);
	await manager.initialize();

	const first = await manager.loadSkill('project:cache-me');
	const second = await manager.loadSkill('project:cache-me');
	t.truthy(first);
	t.truthy(second);
	t.is(first, second);
});

test('SkillManager getLoadedSkill returns undefined when not loaded', async t => {
	process.cwd = () => testDir;
	const mockTm = createMockToolManager();
	const manager = new SkillManager(mockTm);
	await manager.initialize();
	t.is(manager.getLoadedSkill('project:any'), undefined);
});

test('SkillManager getLoadedSkill returns skill after loadSkill', async t => {
	const skillDir = join(testDir, '.nanocoder', 'skills', 'loaded');
	writeSkill(skillDir, {name: 'Loaded', description: 'For getLoadedSkill'});

	process.cwd = () => testDir;
	const mockTm = createMockToolManager();
	const manager = new SkillManager(mockTm);
	await manager.initialize();
	await manager.loadSkill('project:loaded');

	const loaded = manager.getLoadedSkill('project:loaded');
	t.truthy(loaded);
	t.is(loaded!.name, 'Loaded');
});

// ============================================================================
// SkillManager - findRelevantSkills
// ============================================================================

test('SkillManager findRelevantSkills returns ids matching request and tools', async t => {
	const skillDir = join(testDir, '.nanocoder', 'skills', 'api-docs');
	writeSkill(skillDir, {
		name: 'API Docs',
		description: 'Generate API documentation from code',
		category: 'documentation',
		triggers: ['api docs', 'openapi'],
	});

	process.cwd = () => testDir;
	const mockTm = createMockToolManager(['read_file', 'write_file']);
	const manager = new SkillManager(mockTm);
	await manager.initialize();

	const ids = await manager.findRelevantSkills('I need api docs for my REST API', [
		'read_file',
		'write_file',
	]);
	t.true(ids.length >= 1);
	t.true(ids.includes('project:api-docs'));
});

test('SkillManager findRelevantSkills returns empty when no match', async t => {
	process.cwd = () => testDir;
	const mockTm = createMockToolManager();
	const manager = new SkillManager(mockTm);
	await manager.initialize();

	const ids = await manager.findRelevantSkills('xyznonexistentquery123', []);
	t.is(ids.length, 0);
});

// ============================================================================
// SkillManager - executeSkillResource
// ============================================================================

test('SkillManager executeSkillResource reads document resource', async t => {
	const skillDir = join(testDir, '.nanocoder', 'skills', 'res-skill');
	const resourcesDir = join(skillDir, RESOURCES_DIR);
	mkdirSync(resourcesDir, {recursive: true});
	writeSkill(skillDir, {name: 'Res Skill', description: 'Has resource'});
	writeFileSync(join(resourcesDir, 'note.txt'), 'Hello from resource', 'utf-8');

	process.cwd = () => testDir;
	const mockTm = createMockToolManager();
	const manager = new SkillManager(mockTm);
	await manager.initialize();
	const skill = await manager.loadSkill('project:res-skill');
	t.truthy(skill);

	const content = await manager.executeSkillResource(skill!, 'note.txt');
	t.is(content, 'Hello from resource');
});

test('SkillManager executeSkillResource throws when resource not found', async t => {
	const skillDir = join(testDir, '.nanocoder', 'skills', 'no-res');
	writeSkill(skillDir, {name: 'No Res', description: 'No resources'});

	process.cwd = () => testDir;
	const mockTm = createMockToolManager();
	const manager = new SkillManager(mockTm);
	await manager.initialize();
	const skill = await manager.loadSkill('project:no-res');
	t.truthy(skill);

	await t.throwsAsync(
		async () => manager.executeSkillResource(skill!, 'missing.txt'),
		{message: /Resource missing.txt not found/},
	);
});

test('SkillManager executeSkillResource reads template file (document type when not *.template)', async t => {
	const skillDir = join(testDir, '.nanocoder', 'skills', 'tpl-skill');
	const resourcesDir = join(skillDir, RESOURCES_DIR);
	mkdirSync(resourcesDir, {recursive: true});
	writeSkill(skillDir, {name: 'Tpl Skill', description: 'Template'});
	const templateContent = 'Hello {{name}}, version {{ver}}';
	writeFileSync(join(resourcesDir, 'tpl.template.txt'), templateContent, 'utf-8');

	process.cwd = () => testDir;
	const mockTm = createMockToolManager();
	const manager = new SkillManager(mockTm);
	await manager.initialize();
	const skill = await manager.loadSkill('project:tpl-skill');
	t.truthy(skill);

	const content = await manager.executeSkillResource(skill!, 'tpl.template.txt', {
		name: 'World',
		ver: '2',
	});
	// File is detected as document (not template) so content is returned as-is
	t.is(content, templateContent);
});
