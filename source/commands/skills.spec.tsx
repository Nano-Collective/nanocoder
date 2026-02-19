import test from 'ava';
import React from 'react';
import {setToolManagerGetter} from '@/message-handler';
import type {SkillManager} from '@/skills/skill-manager';
import type {ToolManager} from '@/tools/tool-manager';
import type {Message} from '@/types/core';
import type {SkillMetadata} from '@/types/skill';
import {skillsCommand} from './skills';

const mockMetadata: (overrides?: Partial<SkillMetadata>) => SkillMetadata = (
	overrides = {},
) => ({
	id: 'project:test-skill',
	name: 'Test Skill',
	description: 'A skill for testing',
	category: 'testing',
	...overrides,
});

function createMockSkillManager(behaviour: {
	getAvailableSkills?: () => SkillMetadata[];
	loadSkill?: (id: string) => Promise<{
		name: string;
		category: string;
		version: string;
		description: string;
		source: {type: string};
		location: string;
		allowedTools?: string[];
		content?: {examples?: string[]};
		resources?: {name: string; type: string; executable?: boolean}[];
		author?: string;
		lastModified: Date;
	} | null>;
	initialize?: () => Promise<void>;
}): SkillManager {
	return {
		getAvailableSkills: behaviour.getAvailableSkills ?? (() => []),
		loadSkill: behaviour.loadSkill ?? (async () => null),
		initialize: behaviour.initialize ?? (async () => {}),
	} as unknown as SkillManager;
}

function createMockToolManager(skillManager: SkillManager | null): ToolManager {
	return {
		getSkillManager: () => skillManager,
	} as unknown as ToolManager;
}

const emptyMessages: Message[] = [];
const mockMetadataForHandler = {
	provider: 'test',
	model: 'test',
	tokens: 0,
	getMessageTokens: (_m: Message) => 0,
};

test.after.always(() => {
	setToolManagerGetter((): ToolManager | null => null);
});

// ============================================================================
// Command metadata
// ============================================================================

test('skills command has correct name', t => {
	t.is(skillsCommand.name, 'skills');
});

test('skills command has description', t => {
	t.truthy(skillsCommand.description);
	t.true(skillsCommand.description.length > 0);
});

test('skills command handler is a function', t => {
	t.is(typeof skillsCommand.handler, 'function');
});

// ============================================================================
// Handler - no tool manager
// ============================================================================

test('skills command returns message when tool manager is null', async t => {
	setToolManagerGetter((): ToolManager | null => null);
	const result = await skillsCommand.handler(
		[],
		emptyMessages,
		mockMetadataForHandler,
	);
	t.truthy(result);
	t.true(React.isValidElement(result));
	t.true(
		(result as React.ReactElement).props?.message?.includes('not available') ||
			(result as React.ReactElement).props?.message?.includes('not ready'),
	);
});

// ============================================================================
// Handler - list (no skills)
// ============================================================================

test('skills command list returns no-skills message when none available', async t => {
	const mockSm = createMockSkillManager({getAvailableSkills: () => []});
	setToolManagerGetter(() => createMockToolManager(mockSm));
	const result = await skillsCommand.handler(
		[],
		emptyMessages,
		mockMetadataForHandler,
	);
	t.truthy(result);
	t.true(React.isValidElement(result));
	t.true(
		(result as React.ReactElement).props?.message?.includes('No Skills available'),
	);
});

// ============================================================================
// Handler - list (with skills)
// ============================================================================

test('skills command list returns skills grouped by category', async t => {
	const mockSm = createMockSkillManager({
		getAvailableSkills: () => [
			mockMetadata({id: 'project:a', name: 'Skill A', category: 'docs'}),
			mockMetadata({id: 'project:b', name: 'Skill B', category: 'docs'}),
			mockMetadata({id: 'project:c', name: 'Skill C', category: 'testing'}),
		],
	});
	setToolManagerGetter(() => createMockToolManager(mockSm));
	const result = await skillsCommand.handler(
		['list'],
		emptyMessages,
		mockMetadataForHandler,
	);
	t.truthy(result);
	t.true(React.isValidElement(result));
	const message = (result as React.ReactElement).props?.message ?? '';
	t.true(message.includes('Skill A'));
	t.true(message.includes('Skill B'));
	t.true(message.includes('Skill C'));
	t.true(message.includes('project:a'));
});

// ============================================================================
// Handler - show (no id)
// ============================================================================

test('skills command show without id returns usage', async t => {
	const mockSm = createMockSkillManager({});
	setToolManagerGetter(() => createMockToolManager(mockSm));
	const result = await skillsCommand.handler(
		['show'],
		emptyMessages,
		mockMetadataForHandler,
	);
	t.truthy(result);
	t.true(React.isValidElement(result));
	t.true(
		(result as React.ReactElement).props?.message?.includes('Usage:') ||
			(result as React.ReactElement).props?.message?.includes('skill-id'),
	);
});

// ============================================================================
// Handler - show (skill not found)
// ============================================================================

test('skills command show with unknown id returns not found', async t => {
	const mockSm = createMockSkillManager({loadSkill: async () => null});
	setToolManagerGetter(() => createMockToolManager(mockSm));
	const result = await skillsCommand.handler(
		['show', 'project:nonexistent'],
		emptyMessages,
		mockMetadataForHandler,
	);
	t.truthy(result);
	t.true(React.isValidElement(result));
	t.true(
		(result as React.ReactElement).props?.message?.includes('not found'),
	);
});

// ============================================================================
// Handler - show (skill found)
// ============================================================================

test('skills command show with valid id returns skill details', async t => {
	const mockSm = createMockSkillManager({
		loadSkill: async id =>
			id === 'project:my-skill'
				? {
						name: 'My Skill',
						category: 'docs',
						version: '1.0.0',
						description: 'Generates docs',
						source: {type: 'project'},
						location: '/tmp/skills/my-skill',
						allowedTools: ['read_file'],
						content: {examples: ['Example 1']},
						resources: [],
						lastModified: new Date(),
					}
				: null,
	});
	setToolManagerGetter(() => createMockToolManager(mockSm));
	const result = await skillsCommand.handler(
		['show', 'project:my-skill'],
		emptyMessages,
		mockMetadataForHandler,
	);
	t.truthy(result);
	t.true(React.isValidElement(result));
	const message = (result as React.ReactElement).props?.message ?? '';
	t.true(message.includes('My Skill'));
	t.true(message.includes('Generates docs'));
	t.true(message.includes('read_file'));
});

// ============================================================================
// Handler - refresh
// ============================================================================

test('skills command refresh returns success message', async t => {
	let initialized = false;
	const mockSm = createMockSkillManager({
		initialize: async () => {
			initialized = true;
		},
	});
	setToolManagerGetter(() => createMockToolManager(mockSm));
	const result = await skillsCommand.handler(
		['refresh'],
		emptyMessages,
		mockMetadataForHandler,
	);
	t.true(initialized);
	t.truthy(result);
	t.true(React.isValidElement(result));
	t.true(
		(result as React.ReactElement).props?.message?.toLowerCase().includes('refresh'),
	);
});

// ============================================================================
// Handler - unknown subcommand
// ============================================================================

test('skills command unknown subcommand returns usage', async t => {
	const mockSm = createMockSkillManager({});
	setToolManagerGetter(() => createMockToolManager(mockSm));
	const result = await skillsCommand.handler(
		['unknown'],
		emptyMessages,
		mockMetadataForHandler,
	);
	t.truthy(result);
	t.true(React.isValidElement(result));
	t.true((result as React.ReactElement).props?.message?.includes('Usage:'));
});
