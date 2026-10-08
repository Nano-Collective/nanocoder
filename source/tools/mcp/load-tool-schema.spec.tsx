import test from 'ava';
import type React from 'react';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import {setActiveToolManager, ToolManager} from '@/tools/tool-manager';
import {
	executeLoadToolSchema,
	loadToolSchemaTool,
} from './load-tool-schema';

test('loadToolSchemaTool has expected metadata', (t) => {
	t.is(loadToolSchemaTool.name, 'load_tool_schema');
	t.truthy(loadToolSchemaTool.tool.description);
	t.is(typeof loadToolSchemaTool.tool.execute, 'function');
});

test('loadToolSchemaTool validator requires non-empty tool_name', async (t) => {
	const result1 = await loadToolSchemaTool.validator!({tool_name: ''});
	t.false(result1.valid);

	const result2 = await loadToolSchemaTool.validator!({tool_name: 'test_tool'});
	t.true(result2.valid);
});

test('executeLoadToolSchema handles missing tool gracefully', async (t) => {
	const manager = new ToolManager();
	setActiveToolManager(manager);

	const output = await executeLoadToolSchema({tool_name: 'non_existent'});
	t.true(output.includes('was not found in the MCP catalog'));
});

test('loadToolSchemaTool formatter renders output properly', async (t) => {
	const el = await (loadToolSchemaTool.formatter as any)(
		{tool_name: 'github_create_issue'},
		'Successfully loaded tool',
	);

	const {lastFrame} = renderWithTheme(el as React.ReactElement);
	t.true(lastFrame()?.includes('Target MCP Tool:'));
	t.true(lastFrame()?.includes('github_create_issue'));
	t.true(lastFrame()?.includes('Successfully loaded tool'));
});
