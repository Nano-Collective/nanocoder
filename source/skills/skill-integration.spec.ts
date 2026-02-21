import test from 'ava';
import type {Skill, SkillMetadata, SkillSource} from '@/types/skill';
import type {SkillManager} from './skill-manager';
import type {ToolManager} from '@/tools/tool-manager';
import {SkillIntegration} from './skill-integration';

function createMockToolManager(toolNames: string[]): ToolManager {
	return {
		getToolNames: () => toolNames,
	} as unknown as ToolManager;
}

function createMockSkillManager(behaviour: {
	findRelevantSkills?: (request: string, tools: string[]) => Promise<string[]>;
	loadSkill?: (id: string) => Promise<Skill | null>;
	getLoadedSkill?: (id: string) => Skill | undefined;
}): SkillManager {
	return {
		findRelevantSkills: behaviour.findRelevantSkills ?? (async () => []),
		loadSkill: behaviour.loadSkill ?? (async () => null),
		getLoadedSkill: behaviour.getLoadedSkill ?? (() => undefined),
	} as unknown as SkillManager;
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
	const source: SkillSource = {
		type: 'project',
		location: '/tmp/skills',
		priority: 1,
		enabled: true,
	};
	const metadata: SkillMetadata = {
		id: 'project:test',
		name: 'Test Skill',
		description: 'A test skill',
		category: 'general',
	};
	return {
		id: 'project:test',
		name: 'Test Skill',
		description: 'A test skill',
		category: 'general',
		version: '1.0.0',
		metadata,
		content: {
			instructions: 'Do the thing.',
			examples: ['Example one'],
		},
		allowedTools: ['read_file', 'write_file'],
		source,
		location: '/tmp/skills/test',
		lastModified: new Date(),
		...overrides,
	};
}

// ============================================================================
// SkillIntegration - enhanceSystemPrompt
// ============================================================================

test('SkillIntegration enhanceSystemPrompt returns base when no relevant skills', async t => {
	const mockTm = createMockToolManager(['read_file']);
	const mockSm = createMockSkillManager({findRelevantSkills: async () => []});
	const integration = new SkillIntegration(mockSm, mockTm);

	const base = 'You are a helpful assistant.';
	const result = await integration.enhanceSystemPrompt(base, 'some request');
	t.is(result, base);
});

test('SkillIntegration enhanceSystemPrompt appends skills section when skills found', async t => {
	const skill = makeSkill();
	const mockTm = createMockToolManager(['read_file', 'write_file']);
	const mockSm = createMockSkillManager({
		findRelevantSkills: async () => ['project:test'],
		loadSkill: async () => skill,
	});
	const integration = new SkillIntegration(mockSm, mockTm);

	const base = 'Base prompt.';
	const result = await integration.enhanceSystemPrompt(base, 'edit files');
	t.true(result.startsWith(base));
	t.true(result.includes('## Available Skills'));
	t.true(result.includes('### Test Skill'));
	t.true(result.includes('Do the thing.'));
	t.true(result.includes('**Examples:**'));
});

test('SkillIntegration enhanceSystemPrompt returns base when loadSkill returns null', async t => {
	const mockTm = createMockToolManager(['read_file']);
	const mockSm = createMockSkillManager({
		findRelevantSkills: async () => ['project:missing'],
		loadSkill: async () => null,
	});
	const integration = new SkillIntegration(mockSm, mockTm);

	const base = 'Base.';
	const result = await integration.enhanceSystemPrompt(base, 'request');
	t.is(result, base);
});

// ============================================================================
// SkillIntegration - validateSkillToolAccess
// ============================================================================

test('SkillIntegration validateSkillToolAccess returns all allowed when skill has no restrictions', async t => {
	const mockTm = createMockToolManager([]);
	const mockSm = createMockSkillManager({
		getLoadedSkill: () => undefined,
	});
	const integration = new SkillIntegration(mockSm, mockTm);

	const {allowed, blocked} = integration.validateSkillToolAccess('project:any', [
		'read_file',
		'write_file',
	]);
	t.deepEqual(allowed, ['read_file', 'write_file']);
	t.is(blocked.length, 0);
});

test('SkillIntegration validateSkillToolAccess filters by allowedTools', t => {
	const skill = makeSkill({allowedTools: ['read_file']});
	const mockTm = createMockToolManager([]);
	const mockSm = createMockSkillManager({
		getLoadedSkill: (id: string) => (id === 'project:test' ? skill : undefined),
	});
	const integration = new SkillIntegration(mockSm, mockTm);

	const {allowed, blocked} = integration.validateSkillToolAccess('project:test', [
		'read_file',
		'write_file',
		'execute_bash',
	]);
	t.deepEqual(allowed, ['read_file']);
	t.deepEqual(blocked, ['write_file', 'execute_bash']);
});
