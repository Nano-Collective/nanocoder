import test from 'ava';
import {parseYamlObject, splitFrontmatter} from './frontmatter.js';

test('splitFrontmatter extracts a standard frontmatter block', t => {
	const result = splitFrontmatter('---\ntitle: Hello\n---\nBody content');
	t.true(result.hasFrontmatter);
	t.is(result.frontmatter, 'title: Hello');
	t.is(result.body, 'Body content');
});

test('splitFrontmatter handles multi-line frontmatter', t => {
	const result = splitFrontmatter('---\na: 1\nb: 2\n---\nline one\nline two');
	t.true(result.hasFrontmatter);
	t.is(result.frontmatter, 'a: 1\nb: 2');
	t.is(result.body, 'line one\nline two');
});

test('splitFrontmatter handles CRLF line endings', t => {
	const result = splitFrontmatter('---\r\ntitle: Hello\r\n---\r\nBody');
	t.true(result.hasFrontmatter);
	t.is(result.frontmatter, 'title: Hello');
	t.is(result.body, 'Body');
});

test('splitFrontmatter handles a closing delimiter with no trailing newline', t => {
	const result = splitFrontmatter('---\ntitle: Hello\n---');
	t.true(result.hasFrontmatter);
	t.is(result.frontmatter, 'title: Hello');
	t.is(result.body, '');
});

test('splitFrontmatter recognises an empty frontmatter block', t => {
	// Regression: `---\n---\n` used to be unrecognised, leaking the literal
	// `---` delimiters into the body and reporting hasFrontmatter: false.
	const result = splitFrontmatter('---\n---\nBody content');
	t.true(result.hasFrontmatter);
	t.is(result.frontmatter, '');
	t.is(result.body, 'Body content');
});

test('splitFrontmatter recognises a blank-line frontmatter block', t => {
	const result = splitFrontmatter('---\n\n---\nBody');
	t.true(result.hasFrontmatter);
	t.is(result.frontmatter, '');
	t.is(result.body, 'Body');
});

test('splitFrontmatter leaves --- markers inside the body untouched', t => {
	const result = splitFrontmatter('---\ntitle: Hello\n---\nbefore\n---\nafter');
	t.true(result.hasFrontmatter);
	t.is(result.frontmatter, 'title: Hello');
	t.is(result.body, 'before\n---\nafter');
});

test('splitFrontmatter returns the whole file as body when no frontmatter present', t => {
	const content = '# Heading\n\nSome body text';
	const result = splitFrontmatter(content);
	t.false(result.hasFrontmatter);
	t.is(result.frontmatter, '');
	t.is(result.body, content);
});

test('splitFrontmatter does not treat a lone delimiter as frontmatter', t => {
	const content = 'just body\n---\nnot frontmatter';
	const result = splitFrontmatter(content);
	t.false(result.hasFrontmatter);
	t.is(result.body, content);
});

test('parseYamlObject parses a valid YAML object', t => {
	const parsed = parseYamlObject('title: Hello\ncount: 3');
	t.deepEqual(parsed, {title: 'Hello', count: 3});
});

test('parseYamlObject parses nested objects and arrays', t => {
	const parsed = parseYamlObject('tags:\n  - a\n  - b\nmeta:\n  nested: true');
	t.deepEqual(parsed, {tags: ['a', 'b'], meta: {nested: true}});
});

test('parseYamlObject returns an empty object for blank input', t => {
	t.deepEqual(parseYamlObject(''), {});
	t.deepEqual(parseYamlObject('   \n  '), {});
});

test('parseYamlObject returns null for a scalar value', t => {
	t.is(parseYamlObject('just a string'), null);
});

test('parseYamlObject returns null for a top-level array', t => {
	t.is(parseYamlObject('- one\n- two'), null);
});

test('parseYamlObject returns null on invalid YAML', t => {
	t.is(parseYamlObject('key: "unterminated'), null);
});
