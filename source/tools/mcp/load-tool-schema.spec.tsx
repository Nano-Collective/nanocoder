import test from 'ava';
import type React from 'react';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import {ToolManager} from '@/tools/tool-manager';
import {
	createLoadToolSchemaTool,
	executeLoadToolSchema,
	loadToolSchemaFormatter,
	loadToolSchemaValidator,
} from './load-tool-schema';

test('loadToolSchemaTool has expected metadata', (t) => {
	const manager = new ToolManager();
	const toolExport = createLoadToolSchemaTool(manager);
	t.is(toolExport.name, 'load_tool_schema');
	t.truthy(toolExport.tool.description);
	t.is(typeof toolExport.tool.execute, 'function');
});

test('loadToolSchemaTool validator requires non-empty tool_name', async (t) => {
	const result1 = await loadToolSchemaValidator({tool_name: ''});
	t.false(result1.valid);

	const result2 = await loadToolSchemaValidator({tool_name: 'test_tool'});
	t.true(result2.valid);
});

test('executeLoadToolSchema handles missing tool gracefully', async (t) => {
	const manager = new ToolManager();
	const output = await executeLoadToolSchema({tool_name: 'non_existent'}, manager);
	t.true(output.includes('was not found in the MCP catalog'));
});

test('loadToolSchemaTool formatter renders output properly', async (t) => {
	const el = await (loadToolSchemaFormatter as any)(
		{tool_name: 'github_create_issue'},
		'Successfully loaded tool',
	);

	const {lastFrame} = renderWithTheme(el as React.ReactElement);
	t.true(lastFrame()?.includes('Target MCP Tool:'));
	t.true(lastFrame()?.includes('github_create_issue'));
	t.true(lastFrame()?.includes('Successfully loaded tool'));
});
