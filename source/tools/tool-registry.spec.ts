import test from 'ava';
import { ToolRegistry } from './tool-registry';
import type { ToolEntry } from '@/types/index';

// Mock tool handler function - returns Promise<string>
const mockHandler: ToolEntry['handler'] = async () => 'test result';

// Mock formatter function
const mockFormatter: ToolEntry['formatter'] = (output: unknown) => {
	return String(output);
};

// Mock validator function - returns Promise<{valid: true} | {valid: false, error: string}>
const mockValidator: ToolEntry['validator'] = async () => ({ valid: true });

// Mock AI SDK tool - cast to any since we're just testing registry functionality
const mockTool: ToolEntry['tool'] = {
	execute: async () => 'test result',
} as any;

function createMockToolEntry(overrides: Partial<ToolEntry> = {}): ToolEntry {
	return {
		name: 'test-tool',
		handler: mockHandler,
		tool: mockTool,
		formatter: mockFormatter,
		validator: mockValidator,
		...overrides
	} as ToolEntry;
}

test('ToolRegistry - register adds a tool entry', t => {
	const registry = new ToolRegistry();
	const entry = createMockToolEntry();

	registry.register(entry);

	t.true(registry.hasTool('test-tool'));
	t.is(registry.getToolCount(), 1);
});

test('ToolRegistry - registerMany adds multiple tools', t => {
	const registry = new ToolRegistry();
	const entries = [
		createMockToolEntry({ name: 'tool1' }),
		createMockToolEntry({ name: 'tool2' }),
		createMockToolEntry({ name: 'tool3' })
	];

	registry.registerMany(entries);

	t.is(registry.getToolCount(), 3);
	t.true(registry.hasTool('tool1'));
	t.true(registry.hasTool('tool2'));
	t.true(registry.hasTool('tool3'));
});

test('ToolRegistry - registerMany with empty array', t => {
	const registry = new ToolRegistry();

	registry.registerMany([]);

	t.is(registry.getToolCount(), 0);
});

test('ToolRegistry - unregister removes a tool', t => {
	const registry = new ToolRegistry();
	const entry = createMockToolEntry();

	registry.register(entry);
	t.true(registry.hasTool('test-tool'));

	registry.unregister('test-tool');
	t.false(registry.hasTool('test-tool'));
});

test('ToolRegistry - unregisterMany removes multiple tools', t => {
	const registry = new ToolRegistry();
	registry.registerMany([
		createMockToolEntry({ name: 'tool1' }),
		createMockToolEntry({ name: 'tool2' }),
		createMockToolEntry({ name: 'tool3' })
	]);

	registry.unregisterMany(['tool1', 'tool3']);

	t.false(registry.hasTool('tool1'));
	t.true(registry.hasTool('tool2'));
	t.false(registry.hasTool('tool3'));
});

test('ToolRegistry - unregisterMany with empty array', t => {
	const registry = new ToolRegistry();
	const entry = createMockToolEntry();

	registry.register(entry);
	registry.unregisterMany([]);

	t.true(registry.hasTool('test-tool'));
});

test('ToolRegistry - getEntry returns tool entry', t => {
	const registry = new ToolRegistry();
	const entry = createMockToolEntry();

	registry.register(entry);
	const retrieved = registry.getEntry('test-tool');

	t.truthy(retrieved);
	t.is(retrieved?.name, 'test-tool');
});

test('ToolRegistry - getEntry returns undefined for non-existent tool', t => {
	const registry = new ToolRegistry();

	const retrieved = registry.getEntry('non-existent');

	t.is(retrieved, undefined);
});

test('ToolRegistry - getHandler returns tool handler', t => {
	const registry = new ToolRegistry();
	const entry = createMockToolEntry();

	registry.register(entry);
	const handler = registry.getHandler('test-tool');

	t.truthy(handler);
	t.is(handler, mockHandler);
});

test('ToolRegistry - getHandler returns undefined for non-existent tool', t => {
	const registry = new ToolRegistry();

	const handler = registry.getHandler('non-existent');

	t.is(handler, undefined);
});

test('ToolRegistry - getFormatter returns tool formatter', t => {
	const registry = new ToolRegistry();
	const entry = createMockToolEntry();

	registry.register(entry);
	const formatter = registry.getFormatter('test-tool');

	t.truthy(formatter);
	t.is(formatter, mockFormatter);
});

test('ToolRegistry - getFormatter returns undefined when no formatter', t => {
	const registry = new ToolRegistry();
	const entry = createMockToolEntry({ formatter: undefined });

	registry.register(entry);
	const formatter = registry.getFormatter('test-tool');

	t.is(formatter, undefined);
});

test('ToolRegistry - getValidator returns tool validator', t => {
	const registry = new ToolRegistry();
	const entry = createMockToolEntry();

	registry.register(entry);
	const validator = registry.getValidator('test-tool');

	t.truthy(validator);
	t.is(validator, mockValidator);
});

test('ToolRegistry - getValidator returns undefined when no validator', t => {
	const registry = new ToolRegistry();
	const entry = createMockToolEntry({ validator: undefined });

	registry.register(entry);
	const validator = registry.getValidator('test-tool');

	t.is(validator, undefined);
});

test('ToolRegistry - getTool returns native AI SDK tool', t => {
	const registry = new ToolRegistry();
	const entry = createMockToolEntry();

	registry.register(entry);
	const tool = registry.getTool('test-tool');

	t.truthy(tool);
	t.is(tool, mockTool);
});

test('ToolRegistry - getTool returns undefined for non-existent tool', t => {
	const registry = new ToolRegistry();

	const tool = registry.getTool('non-existent');

	t.is(tool, undefined);
});

test('ToolRegistry - getHandlers returns record of all handlers', t => {
	const registry = new ToolRegistry();
	const handler1: ToolEntry['handler'] = async () => 'result 1';
	const handler2: ToolEntry['handler'] = async () => 'result 2';

	registry.registerMany([
		createMockToolEntry({ name: 'tool1', handler: handler1 }),
		createMockToolEntry({ name: 'tool2', handler: handler2 })
	]);

	const handlers = registry.getHandlers();

	t.is(handlers.tool1, handler1);
	t.is(handlers.tool2, handler2);
});

test('ToolRegistry - getHandlers returns empty object when no tools', t => {
	const registry = new ToolRegistry();

	const handlers = registry.getHandlers();

	t.deepEqual(handlers, {});
});

test('ToolRegistry - getFormatters returns record of formatters', t => {
	const registry = new ToolRegistry();
	const formatter1: ToolEntry['formatter'] = (o) => String(o);
	const formatter2: ToolEntry['formatter'] = (o) => String(o);

	registry.registerMany([
		createMockToolEntry({ name: 'tool1', formatter: formatter1 }),
		createMockToolEntry({ name: 'tool2', formatter: formatter2 }),
		createMockToolEntry({ name: 'tool3', formatter: undefined })
	]);

	const formatters = registry.getFormatters();

	t.is(formatters.tool1, formatter1);
	t.is(formatters.tool2, formatter2);
	// tool3 has no formatter, so it shouldn't be in the record
	t.false('tool3' in formatters);
});

test('ToolRegistry - getValidators returns record of validators', t => {
	const registry = new ToolRegistry();
	const validator1: ToolEntry['validator'] = async () => ({ valid: true });
	const validator2: ToolEntry['validator'] = async () => ({ valid: false, error: 'test error' });

	registry.registerMany([
		createMockToolEntry({ name: 'tool1', validator: validator1 }),
		createMockToolEntry({ name: 'tool2', validator: validator2 }),
		createMockToolEntry({ name: 'tool3', validator: undefined })
	]);

	const validators = registry.getValidators();

	t.is(validators.tool1, validator1);
	t.is(validators.tool2, validator2);
	// tool3 has no validator, so it shouldn't be in the record
	t.false('tool3' in validators);
});

test('ToolRegistry - getNativeTools returns record of native tools', t => {
	const registry = new ToolRegistry();
	const tool1: ToolEntry['tool'] = { execute: async () => 'test 1' } as any;
	const tool2: ToolEntry['tool'] = { execute: async () => 'test 2' } as any;

	registry.registerMany([
		createMockToolEntry({ name: 'tool1', tool: tool1 }),
		createMockToolEntry({ name: 'tool2', tool: tool2 })
	]);

	const nativeTools = registry.getNativeTools();

	t.truthy(nativeTools.tool1);
	t.truthy(nativeTools.tool2);
	t.is(Object.keys(nativeTools).length, 2);
});

test('ToolRegistry - getNativeTools returns unwrapped tools when no validator', t => {
	const registry = new ToolRegistry();
	const tool1: ToolEntry['tool'] = { execute: async () => 'test 1' } as any;

	registry.register(createMockToolEntry({ name: 'tool1', tool: tool1, validator: undefined }));

	const nativeTools = registry.getNativeTools();

	t.is(nativeTools.tool1, tool1);
});

test('ToolRegistry - getNativeTools wraps execute with validator', async t => {
	const registry = new ToolRegistry();
	const tool1: ToolEntry['tool'] = { execute: async () => 'test result' } as any;
	const rejectValidator = async () => ({ valid: false as const, error: 'path not allowed' });

	registry.register(createMockToolEntry({ name: 'tool1', tool: tool1, validator: rejectValidator }));

	const nativeTools = registry.getNativeTools();

	await t.throwsAsync(() => nativeTools.tool1.execute!({} as any, {} as any), {
		message: 'path not allowed',
	});
});

test('ToolRegistry - getAllEntries returns array of all entries', t => {
	const registry = new ToolRegistry();
	const entry1 = createMockToolEntry({ name: 'tool1' });
	const entry2 = createMockToolEntry({ name: 'tool2' });

	registry.registerMany([entry1, entry2]);

	const entries = registry.getAllEntries();

	t.is(entries.length, 2);
	t.true(entries.some(e => e.name === 'tool1'));
	t.true(entries.some(e => e.name === 'tool2'));
});

test('ToolRegistry - getAllEntries returns empty array when no tools', t => {
	const registry = new ToolRegistry();

	const entries = registry.getAllEntries();

	t.deepEqual(entries, []);
});

test('ToolRegistry - getToolNames returns array of tool names', t => {
	const registry = new ToolRegistry();
	registry.registerMany([
		createMockToolEntry({ name: 'tool1' }),
		createMockToolEntry({ name: 'tool2' }),
		createMockToolEntry({ name: 'tool3' })
	]);

	const names = registry.getToolNames();

	t.is(names.length, 3);
	t.true(names.includes('tool1'));
	t.true(names.includes('tool2'));
	t.true(names.includes('tool3'));
});

test('ToolRegistry - getToolNames returns empty array when no tools', t => {
	const registry = new ToolRegistry();

	const names = registry.getToolNames();

	t.deepEqual(names, []);
});

test('ToolRegistry - hasTool returns true for registered tool', t => {
	const registry = new ToolRegistry();
	registry.register(createMockToolEntry());

	t.true(registry.hasTool('test-tool'));
});

test('ToolRegistry - hasTool returns false for non-existent tool', t => {
	const registry = new ToolRegistry();

	t.false(registry.hasTool('non-existent'));
});

test('ToolRegistry - getToolCount returns correct count', t => {
	const registry = new ToolRegistry();

	t.is(registry.getToolCount(), 0);

	registry.register(createMockToolEntry());
	t.is(registry.getToolCount(), 1);

	registry.registerMany([
		createMockToolEntry({ name: 'tool1' }),
		createMockToolEntry({ name: 'tool2' })
	]);
	t.is(registry.getToolCount(), 3);
});

test('ToolRegistry - clear removes all tools', t => {
	const registry = new ToolRegistry();
	registry.registerMany([
		createMockToolEntry({ name: 'tool1' }),
		createMockToolEntry({ name: 'tool2' }),
		createMockToolEntry({ name: 'tool3' })
	]);

	registry.clear();

	t.is(registry.getToolCount(), 0);
	t.false(registry.hasTool('tool1'));
	t.false(registry.hasTool('tool2'));
	t.false(registry.hasTool('tool3'));
});

test('ToolRegistry - fromRegistries creates registry from records', t => {
	const handler1: ToolEntry['handler'] = async () => 'test';
	const handler2: ToolEntry['handler'] = async () => 'test';
	const formatter1: ToolEntry['formatter'] = (o) => String(o);
	const validator1: ToolEntry['validator'] = async () => ({ valid: true });
	const tool1: ToolEntry['tool'] = { execute: async () => 'test' } as any;
	const tool2: ToolEntry['tool'] = { execute: async () => 'test' } as any;

	const handlers = { tool1: handler1, tool2: handler2 };
	const tools = { tool1, tool2 };
	const formatters = { tool1: formatter1 };
	const validators = { tool1: validator1 };

	const registry = ToolRegistry.fromRegistries(handlers, tools, formatters, validators);

	t.is(registry.getToolCount(), 2);
	t.true(registry.hasTool('tool1'));
	t.true(registry.hasTool('tool2'));
	t.is(registry.getHandler('tool1'), handler1);
	t.is(registry.getFormatter('tool1'), formatter1);
	t.is(registry.getValidator('tool1'), validator1);
});

test('ToolRegistry - fromRegistries with optional parameters', t => {
	const handler: ToolEntry['handler'] = async () => 'test';
	const tool: ToolEntry['tool'] = { execute: async () => 'test' } as any;

	const registry = ToolRegistry.fromRegistries({ tool1: handler }, { tool1: tool });

	t.is(registry.getToolCount(), 1);
	t.is(registry.getFormatter('tool1'), undefined);
	t.is(registry.getValidator('tool1'), undefined);
});

test('ToolRegistry - fromRegistries skips tools without matching handlers', t => {
	const handler: ToolEntry['handler'] = async () => 'test';
	const tool: ToolEntry['tool'] = { execute: async () => 'test' } as any;

	const registry = ToolRegistry.fromRegistries(
		{ tool1: handler }, // Only has handler for tool1
		{ tool1: tool, tool2: tool } // But tools for tool1 and tool2
	);

	t.is(registry.getToolCount(), 1);
	t.true(registry.hasTool('tool1'));
	t.false(registry.hasTool('tool2'));
});
