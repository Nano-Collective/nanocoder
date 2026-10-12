import test from 'ava';
import {MCPToolCatalog} from './tool-catalog';

test('MCPToolCatalog registers tools and tracks loaded status', (t) => {
	const catalog = new MCPToolCatalog();

	catalog.add('postgres', {
		name: 'execute_sql',
		description: 'Executes SQL query',
		serverName: 'postgres',
		readOnly: true,
	});

	catalog.add('github', {
		name: 'create_issue',
		description: 'Creates a GitHub issue',
		serverName: 'github',
		readOnly: false,
	});

	t.is(catalog.size, 2);
	t.true(catalog.has('execute_sql'));
	t.true(catalog.has('create_issue'));
	t.false(catalog.has('unknown_tool'));

	t.is(catalog.getUnloaded().length, 2);
	t.is(catalog.getLoaded().length, 0);

	t.true(catalog.markLoaded('execute_sql'));
	t.true(catalog.isLoaded('execute_sql'));
	t.false(catalog.isLoaded('create_issue'));

	t.is(catalog.getUnloaded().length, 1);
	t.is(catalog.getLoaded().length, 1);
	t.is(catalog.getLoaded()[0]?.name, 'execute_sql');
});

test('MCPToolCatalog removes tools by server', (t) => {
	const catalog = new MCPToolCatalog();

	catalog.add('serverA', {name: 'tool1', serverName: 'serverA'});
	catalog.add('serverA', {name: 'tool2', serverName: 'serverA'});
	catalog.add('serverB', {name: 'tool3', serverName: 'serverB'});

	const removed = catalog.removeServerTools('serverA');
	t.deepEqual(removed, ['tool1', 'tool2']);
	t.is(catalog.size, 1);
	t.false(catalog.has('tool1'));
	t.true(catalog.has('tool3'));
});

test('MCPToolCatalog formats compact prompt section for unloaded tools', (t) => {
	const catalog = new MCPToolCatalog();

	catalog.add('db', {
		name: 'query_db',
		description: 'Query the database',
		serverName: 'db',
		readOnly: true,
	});

	const section = catalog.formatCatalogSection();
	t.true(section.includes('Available On-Demand MCP Tools'));
	t.true(section.includes('`query_db` (db): Query the database [read-only]'));

	catalog.markLoaded('query_db');
	t.is(catalog.formatCatalogSection(), '');
});
