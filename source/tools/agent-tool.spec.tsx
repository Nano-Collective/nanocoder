/**
 * Agent Tool Tests
 */

import test from 'ava';
import {setAgentToolExecutor, agentTool} from './agent-tool.js';
import {SubagentExecutor} from '@/subagents/subagent-executor.js';
import type {ToolManager} from '@/types/core';
import type {LLMClient} from '@/types/core';

console.log('\nagent-tool.spec.tsx');

// Mock tool manager
const createMockToolManager = (): ToolManager => ({
	getAllTools: () => ({}),
	getToolHandler: () => (() => Promise.resolve('mock result')),
} as unknown as ToolManager);

// Mock LLM client
const createMockClient = (): LLMClient => ({
	chat: async () => ({
		choices: [{
			message: {
				content: 'Test response',
				tool_calls: undefined,
			},
		}],
	}),
	setModel: () => {},
} as unknown as LLMClient);

// ============================================================================
// Export Structure Tests
// ============================================================================

test.serial('agentTool export has correct structure', t => {
	t.is(agentTool.name, 'agent');
	t.true(typeof agentTool.tool === 'object');
	t.true(typeof agentTool.formatter === 'function');
	t.true(agentTool.readOnly === true);
});

test.serial('agentTool tool has execute function', t => {
	t.true('execute' in agentTool.tool);
	t.is(typeof agentTool.tool.execute, 'function');
});

test.serial('agentTool tool has description', t => {
	t.is(typeof agentTool.tool.description, 'string');
	t.true(agentTool.tool.description.length > 0);
});

test.serial('agentTool has needsApproval property', t => {
	t.is(typeof agentTool.tool.needsApproval, 'boolean');
	t.is(agentTool.tool.needsApproval, false);
});

// ============================================================================
// Executor Tests
// ============================================================================

test.serial('setAgentToolExecutor sets the executor instance', t => {
	const executor = new SubagentExecutor(createMockToolManager(), createMockClient());

	// Should not throw
	setAgentToolExecutor(executor);
	t.pass();
});

test.serial('executor can be set multiple times', t => {
	const executor1 = new SubagentExecutor(createMockToolManager(), createMockClient());
	const executor2 = new SubagentExecutor(createMockToolManager(), createMockClient());

	setAgentToolExecutor(executor1);
	setAgentToolExecutor(executor2);

	t.pass(); // If we got here, multiple sets work
});

test.serial('executor can be set to null', t => {
	setAgentToolExecutor(null as unknown as SubagentExecutor);
	t.pass();
});

// ============================================================================
// Tool Execution Tests
// ============================================================================

test.serial('tool.execute throws when executor not initialized', async t => {
	// Clear executor
	setAgentToolExecutor(null as unknown as SubagentExecutor);

	await t.throwsAsync(
		async () => agentTool.tool.execute(
			{
				subagent_type: 'explore',
				description: 'Test task',
			},
			{
				toolCallId: 'test-1',
				messages: [],
			},
		),
		{message: /Subagent executor not initialized/},
	);
});

test.serial('tool.execute throws for non-existent subagent', async t => {
	const executor = new SubagentExecutor(createMockToolManager(), createMockClient());
	setAgentToolExecutor(executor);

	await t.throwsAsync(
		async () => agentTool.tool.execute(
			{
				subagent_type: 'non-existent-agent-xyz',
				description: 'Test task',
			},
			{
				toolCallId: 'test-2',
				messages: [],
			},
		),
		{message: /Subagent 'non-existent-agent-xyz' not found/},
	);
});

// ============================================================================
// Formatter Tests
// ============================================================================

test.serial('formatter returns a function result', t => {
	const args = {
		subagent_type: 'explore',
		description: 'Find all files',
	};
	const result = 'Found 10 files';

	const formatted = agentTool.formatter(args, result);
	t.true(typeof formatted === 'object' || typeof formatted === 'string');
});

// ============================================================================
// ReadOnly Tests
// ============================================================================

test.serial('agentTool is marked as readOnly', t => {
	t.true(agentTool.readOnly === true);
});
