import anyTest, {type ExecutionContext} from 'ava';
import {
	collapseBeyondDepth,
	deleteAtPath,
	extractTreeValue,
	findNodeByPath,
	flattenTree,
	parseJsonToTree,
	parseKeyValueInput,
	setValueAtPath,
	toggleCollapse,
	addSibling,
	getValueAtPath,
} from './json-tree';

const test = anyTest as any;

// ─── Parsing ─────────────────────────────────────────────────────────────────

test('parseJsonToTree: primitive values', t => {
	t.is(parseJsonToTree(null).kind, 'null');
	t.is(parseJsonToTree(null).value, null);

	t.is(parseJsonToTree(true).kind, 'boolean');
	t.is(parseJsonToTree(true).value, true);

	t.is(parseJsonToTree(42).kind, 'number');
	t.is(parseJsonToTree(42).value, 42);

	t.is(parseJsonToTree('hello').kind, 'string');
	t.is(parseJsonToTree('hello').value, 'hello');
});

test('parseJsonToTree: object', t => {
	const tree = parseJsonToTree({name: 'test', count: 3});
	t.is(tree.kind, 'object');
	t.is(tree.size, 2);
	t.is(tree.children[0].key, 'name');
	t.is(tree.children[0].value, 'test');
	t.is(tree.children[1].key, 'count');
	t.is(tree.children[1].value, 3);
});

test('parseJsonToTree: array', t => {
	const tree = parseJsonToTree([1, 'two', true]);
	t.is(tree.kind, 'array');
	t.is(tree.size, 3);
	t.is(tree.children[0].value, 1);
	t.is(tree.children[1].value, 'two');
	t.is(tree.children[2].value, true);
});

test('parseJsonToTree: nested structure', t => {
	const tree = parseJsonToTree({a: {b: [1, 2]}});
	t.is(tree.kind, 'object');
	t.is(tree.children[0].key, 'a');
	t.is(tree.children[0].children[0].key, 'b');
	t.is(tree.children[0].children[0].children[0].value, 1);
	t.is(tree.children[0].children[0].children[1].value, 2);
});

test('parseJsonToTree: depth tracking', t => {
	const tree = parseJsonToTree({a: {b: {c: 'deep'}}});
	t.is(tree.depth, 0);
	t.is(tree.children[0].depth, 1);
	t.is(tree.children[0].children[0].depth, 2);
	t.is(tree.children[0].children[0].children[0].depth, 3);
});

// ─── Flattening ──────────────────────────────────────────────────────────────

test('flattenTree: simple object', t => {
	const tree = parseJsonToTree({a: 1, b: 'two'});
	const rows = flattenTree(tree);

	t.is(rows.length, 4); // { , a:1, b:"two", }
	t.is(rows[0].value, '{');
	t.is(rows[0].hasChildren, true);
	t.is(rows[1].key, 'a');
	t.is(rows[1].value, '1');
	t.is(rows[1].trailing, ',');
	t.is(rows[2].key, 'b');
	t.is(rows[2].value, '"two"');
	t.is(rows[2].trailing, '');
	t.is(rows[3].value, '}');
});

test('flattenTree: collapsed object shows summary', t => {
	const tree = parseJsonToTree({a: {b: 1, c: 2}});
	tree.children[0].collapsed = true;
	const rows = flattenTree(tree);

	t.is(rows.length, 3); // { , a: { ... }, }
	t.is(rows[1].value, '{ ... }');
	t.is(rows[1].isCollapsed, true);
	t.is(rows[1].hiddenCount, 2);
});

test('flattenTree: array', t => {
	const tree = parseJsonToTree([1, 2, 3]);
	const rows = flattenTree(tree);

	t.is(rows.length, 5); // [ , 1, 2, 3, ]
	t.is(rows[0].value, '[');
	t.is(rows[1].value, '1');
	t.is(rows[1].trailing, ',');
	t.is(rows[3].value, '3');
	t.is(rows[3].trailing, '');
	t.is(rows[4].value, ']');
});

test('flattenTree: path segments', t => {
	const tree = parseJsonToTree({providers: {ollama: {url: 'http://localhost'}}});
	const rows = flattenTree(tree);

	// Find the url row
	const urlRow = rows.find(r => r.key === 'url');
	t.truthy(urlRow);
	t.true(urlRow!.pathSegments.includes('providers'));
	t.true(urlRow!.pathSegments.includes('ollama'));
	t.true(urlRow!.pathSegments.includes('url'));
});

test('flattenTree: array index in path', t => {
	const tree = parseJsonToTree({items: [{name: 'first'}]});
	const rows = flattenTree(tree);

	const nameRow = rows.find(r => r.key === 'name');
	t.truthy(nameRow);
	t.true(nameRow!.pathSegments.includes('[0]'));
});

test('flattenTree: line numbers are sequential', t => {
	const tree = parseJsonToTree({a: 1, b: 2, c: 3});
	const rows = flattenTree(tree);

	for (let i = 0; i < rows.length; i++) {
		t.is(rows[i].lineNumber, i + 1);
	}
});

// ─── Path Utilities ──────────────────────────────────────────────────────────

test('findNodeByPath: object path', t => {
	const tree = parseJsonToTree({a: {b: {c: 'found'}}});
	const node = findNodeByPath(tree, ['a', 'b', 'c']);
	t.truthy(node);
	t.is(node!.value, 'found');
});

test('findNodeByPath: array path', t => {
	const tree = parseJsonToTree({items: [{name: 'first'}, {name: 'second'}]});
	const node = findNodeByPath(tree, ['items', '[1]', 'name']);
	t.truthy(node);
	t.is(node!.value, 'second');
});

test('findNodeByPath: nonexistent path returns null', t => {
	const tree = parseJsonToTree({a: 1});
	t.is(findNodeByPath(tree, ['a', 'b']), null);
	t.is(findNodeByPath(tree, ['z']), null);
});

test('getValueAtPath: nested value', t => {
	const data = {a: {b: {c: 'deep'}}};
	t.is(getValueAtPath(data, ['a', 'b', 'c']), 'deep');
	t.deepEqual(getValueAtPath(data, ['a', 'b']), {c: 'deep'});
});

// ─── Mutations ───────────────────────────────────────────────────────────────

test('toggleCollapse: toggles collapsed state', t => {
	const tree = parseJsonToTree({a: {b: 1}});
	t.is(tree.children[0].collapsed, false);

	const updated = toggleCollapse(tree, ['a']);
	t.is(updated.children[0].collapsed, true);

	const updated2 = toggleCollapse(updated, ['a']);
	t.is(updated2.children[0].collapsed, false);
});

test('toggleCollapse: original tree unchanged', t => {
	const tree = parseJsonToTree({a: {b: 1}});
	toggleCollapse(tree, ['a']);
	t.is(tree.children[0].collapsed, false);
});

test('collapseBeyondDepth: collapses nodes beyond maxDepth', t => {
	const tree = parseJsonToTree({a: {b: {c: {d: 'deep'}}}});
	const collapsed = collapseBeyondDepth(tree, 1);

	t.is(collapsed.collapsed, false);
	t.is(collapsed.children[0].collapsed, true); // depth 1 >= maxDepth 1
});

test('setValueAtPath: changes primitive value', t => {
	const tree = parseJsonToTree({name: 'old', count: 5});
	const updated = setValueAtPath(tree, ['name'], 'new');

	t.is(updated.children[0].value, 'new');
	t.is(updated.children[1].value, 5);
});

test('setValueAtPath: nested value', t => {
	const tree = parseJsonToTree({a: {b: {c: 1}}});
	const updated = setValueAtPath(tree, ['a', 'b', 'c'], 99);

	const node = findNodeByPath(updated, ['a', 'b', 'c']);
	t.is(node!.value, 99);
});

test('setValueAtPath: original tree unchanged', t => {
	const tree = parseJsonToTree({name: 'old'});
	setValueAtPath(tree, ['name'], 'new');
	t.is(tree.children[0].value, 'old');
});

test('deleteAtPath: removes object property', t => {
	const tree = parseJsonToTree({a: 1, b: 2, c: 3});
	const updated = deleteAtPath(tree, ['b']);

	t.is(updated.size, 2);
	t.is(updated.children[0].key, 'a');
	t.is(updated.children[1].key, 'c');
});

test('deleteAtPath: removes array element', t => {
	const tree = parseJsonToTree([1, 2, 3]);
	const updated = deleteAtPath(tree, ['[1]']);

	t.is(updated.size, 2);
	t.is(updated.children[0].value, 1);
	t.is(updated.children[1].value, 3);
	t.is(updated.children[1].index, 1); // re-indexed
});

test('addSibling: adds to object', t => {
	const tree = parseJsonToTree({a: 1});
	const updated = addSibling(tree, ['a'], {key: 'b', value: null});

	t.is(updated.size, 2);
	t.is(updated.children[1].key, 'b');
	t.is(updated.children[1].value, null);
});

test('addSibling: adds to array', t => {
	const tree = parseJsonToTree([1, 2]);
	const updated = addSibling(tree, ['[0]'], {key: '', value: null});

	t.is(updated.size, 3);
	t.is(updated.children[0].value, 1);
	t.is(updated.children[1].value, null);
	t.is(updated.children[2].value, 2);
});

// ─── Extract ─────────────────────────────────────────────────────────────────

test('extractTreeValue: round-trips data', t => {
	const original = {name: 'test', items: [1, {nested: true}], count: null};
	const tree = parseJsonToTree(original);
	const extracted = extractTreeValue(tree);

	t.deepEqual(extracted, original);
});

test('extractTreeValue: after mutation round-trips', t => {
	const original = {a: {b: 1}};
	const tree = parseJsonToTree(original);
	const updated = setValueAtPath(tree, ['a', 'b'], 99);
	const extracted = extractTreeValue(updated);

	t.deepEqual(extracted, {a: {b: 99}});
});

test('extractTreeValue: after delete round-trips', t => {
	const original = {a: 1, b: 2, c: 3};
	const tree = parseJsonToTree(original);
	const updated = deleteAtPath(tree, ['b']);
	const extracted = extractTreeValue(updated);

	t.deepEqual(extracted, {a: 1, c: 3});
});

// ─── parseKeyValueInput ────────────────────────────────────────────────────

test('parseKeyValueInput: key only', t => {
	const {key, value} = parseKeyValueInput('myKey');
	t.is(key, 'myKey');
	t.is(value, null);
});

test('parseKeyValueInput: key with null value', t => {
	const {key, value} = parseKeyValueInput('myKey:');
	t.is(key, 'myKey');
	t.is(value, null);
});

test('parseKeyValueInput: key with string value', t => {
	const {key, value} = parseKeyValueInput('myKey: hello');
	t.is(key, 'myKey');
	t.is(value, 'hello');
});

test('parseKeyValueInput: key with quoted string value', t => {
	const {key, value} = parseKeyValueInput('myKey: "hello world"');
	t.is(key, 'myKey');
	t.is(value, 'hello world');
});

test('parseKeyValueInput: key with number value', t => {
	const {key, value} = parseKeyValueInput('myKey: 42');
	t.is(key, 'myKey');
	t.is(value, 42);
});

test('parseKeyValueInput: key with boolean value', t => {
	t.is(parseKeyValueInput('myKey: true').value, true);
	t.is(parseKeyValueInput('myKey: false').value, false);
});

test('parseKeyValueInput: key with null literal', t => {
	t.is(parseKeyValueInput('myKey: null').value, null);
});

test('parseKeyValueInput: key with empty object', t => {
	const {key, value} = parseKeyValueInput('myKey: {}');
	t.is(key, 'myKey');
	t.deepEqual(value, {});
});

test('parseKeyValueInput: key with empty array', t => {
	const {key, value} = parseKeyValueInput('myKey: []');
	t.is(key, 'myKey');
	t.deepEqual(value, []);
});

test('parseKeyValueInput: key with valid JSON object', t => {
	const {key, value} = parseKeyValueInput('myKey: {"a": 1, "b": 2}');
	t.is(key, 'myKey');
	t.deepEqual(value, {a: 1, b: 2});
});

test('parseKeyValueInput: key with lenient object (unquoted keys)', t => {
	const {key, value} = parseKeyValueInput('myKey: {a: 1, b: hello}');
	t.is(key, 'myKey');
	t.deepEqual(value, {a: 1, b: 'hello'});
});

test('parseKeyValueInput: key with nested lenient object', t => {
	const {key, value} = parseKeyValueInput('myKey: {sub: {deep: val}}');
	t.is(key, 'myKey');
	t.deepEqual(value, {sub: {deep: 'val'}});
});

test('parseKeyValueInput: key with array value', t => {
	const {key, value} = parseKeyValueInput('myKey: [1, 2, 3]');
	t.is(key, 'myKey');
	t.deepEqual(value, [1, 2, 3]);
});

test('parseKeyValueInput: empty input defaults', t => {
	const {key, value} = parseKeyValueInput('');
	t.is(key, 'newKey');
	t.is(value, null);
});

test('parseKeyValueInput: integrates with addSibling', t => {
	const tree = parseJsonToTree({existing: 1});
	const parsed = parseKeyValueInput('newKey: {a: 1, b: 2}');
	const updated = addSibling(tree, ['existing'], parsed);

	t.is(updated.size, 2);
	const extracted = extractTreeValue(updated);
	t.deepEqual(extracted, {existing: 1, newKey: {a: 1, b: 2}});
});
