import test from 'ava';
import type {ToolManager} from '@/tools/tool-manager';
import type {CustomCommand} from '@/types/commands';
import {CommandIntegration} from './command-integration';
import type {CustomCommandLoader} from './loader';

// ============================================================================
// Helpers
// ============================================================================

function createMockToolManager(toolNames: string[] = []): ToolManager {
	return {
		getToolNames: () => toolNames,
	} as unknown as ToolManager;
}

function createMockLoader(behaviour: {
	findRelevantCommands?: (
		request: string,
		tools: string[],
	) => CustomCommand[];
}): CustomCommandLoader {
	return {
		findRelevantCommands:
			behaviour.findRelevantCommands ?? (() => []),
	} as unknown as CustomCommandLoader;
}

function createTestCommand(overrides?: Partial<CustomCommand>): CustomCommand {
	return {
		name: 'test-cmd',
		fullName: 'test-cmd',
		path: '/test/test-cmd.md',
		metadata: {description: 'A test command'},
		content: 'Do the thing.',
		...overrides,
	};
}

const mockTm = createMockToolManager(['read_file', 'string_replace', 'bash']);

// ============================================================================
// enhanceSystemPrompt
// ============================================================================

test('enhanceSystemPrompt returns base prompt when no relevant commands', t => {
	const loader = createMockLoader({findRelevantCommands: () => []});
	const integration = new CommandIntegration(loader, mockTm);

	const result = integration.enhanceSystemPrompt('base', 'hello');
	t.is(result, 'base');
});

test('enhanceSystemPrompt appends skills section when relevant commands found', t => {
	const cmd = createTestCommand({
		name: 'api-docs',
		content: 'Generate API documentation',
		metadata: {
			description: 'Generate OpenAPI specs',
			triggers: ['api docs'],
		},
	});
	const loader = createMockLoader({
		findRelevantCommands: () => [cmd],
	});
	const integration = new CommandIntegration(loader, mockTm);

	const result = integration.enhanceSystemPrompt(
		'base prompt',
		'generate api docs',
	);

	t.true(result.startsWith('base prompt'));
	t.true(result.includes('## Available Skills'));
	t.true(result.includes('Generate API documentation'));
	t.true(result.includes('Tool restrictions listed in a Skill are enforced'));
});

test('enhanceSystemPrompt includes examples when present', t => {
	const cmd = createTestCommand({
		content: 'Instructions here',
		metadata: {
			description: 'A skill',
			examples: ['Example one', 'Example two'],
		},
	});
	const loader = createMockLoader({
		findRelevantCommands: () => [cmd],
	});
	const integration = new CommandIntegration(loader, mockTm);

	const result = integration.enhanceSystemPrompt('base', 'request');

	t.true(result.includes('**Examples:**'));
	t.true(result.includes('Example one'));
	t.true(result.includes('Example two'));
});

test('enhanceSystemPrompt includes resources when present', t => {
	const cmd = createTestCommand({
		content: 'Instructions here',
		metadata: {description: 'A skill'},
		loadedResources: [
			{
				name: 'template.yaml',
				path: '/resources/template.yaml',
				type: 'config',
			},
			{
				name: 'run.sh',
				path: '/resources/run.sh',
				type: 'script',
				executable: true,
			},
		],
	});
	const loader = createMockLoader({
		findRelevantCommands: () => [cmd],
	});
	const integration = new CommandIntegration(loader, mockTm);

	const result = integration.enhanceSystemPrompt('base', 'request');

	t.true(result.includes('**Available Resources:**'));
	t.true(result.includes('`template.yaml` (config): Use via skill resource'));
	t.true(result.includes('`run.sh` (script): Execute via skill resource'));
});

test('enhanceSystemPrompt handles multiple relevant commands', t => {
	const cmd1 = createTestCommand({
		name: 'cmd1',
		fullName: 'cmd1',
		content: 'First command instructions',
		metadata: {description: 'First'},
	});
	const cmd2 = createTestCommand({
		name: 'cmd2',
		fullName: 'cmd2',
		content: 'Second command instructions',
		metadata: {description: 'Second'},
	});
	const loader = createMockLoader({
		findRelevantCommands: () => [cmd1, cmd2],
	});
	const integration = new CommandIntegration(loader, mockTm);

	const result = integration.enhanceSystemPrompt('base', 'request');

	t.true(result.includes('First command instructions'));
	t.true(result.includes('Second command instructions'));
});
