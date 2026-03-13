import test from 'ava';
import {compressIndentation, normalizeIndentation} from './indentation-normalizer';

// === compressIndentation tests ===

test('compressIndentation - empty array returns empty array', t => {
	const result = compressIndentation([]);
	t.deepEqual(result, []);
});

test('compressIndentation - line with no indentation unchanged', t => {
	const result = compressIndentation(['const x = 1;']);
	t.deepEqual(result, ['const x = 1;']);
});

test('compressIndentation - converts tabs to 2 spaces', t => {
	const input = [
		'function test() {',
		'\treturn 1;',
		'}',
	];
	const expected = [
		'function test() {',
		'  return 1;',
		'}',
	];
	t.deepEqual(compressIndentation(input), expected);
});

test('compressIndentation - converts 4 spaces to 2 spaces', t => {
	const input = [
		'function test() {',
		'    return 1;',
		'}',
	];
	const expected = [
		'function test() {',
		'  return 1;',
		'}',
	];
	t.deepEqual(compressIndentation(input), expected);
});

test('compressIndentation - handles multiple indent levels with tabs', t => {
	const input = [
		'function test() {',
		'\tif (true) {',
		'\t\treturn 1;',
		'\t}',
		'}',
	];
	const expected = [
		'function test() {',
		'  if (true) {',
		'    return 1;',
		'  }',
		'}',
	];
	t.deepEqual(compressIndentation(input), expected);
});

test('compressIndentation - handles multiple indent levels with 4 spaces', t => {
	const input = [
		'function test() {',
		'    if (true) {',
		'        return 1;',
		'    }',
		'}',
	];
	const expected = [
		'function test() {',
		'  if (true) {',
		'    return 1;',
		'  }',
		'}',
	];
	t.deepEqual(compressIndentation(input), expected);
});

test('compressIndentation - preserves empty lines', t => {
	const input = [
		'function test() {',
		'',
		'\treturn 1;',
		'}',
	];
	const expected = [
		'function test() {',
		'',
		'  return 1;',
		'}',
	];
	t.deepEqual(compressIndentation(input), expected);
});

test('compressIndentation - preserves whitespace-only lines', t => {
	const input = [
		'function test() {',
		'    ',
		'\treturn 1;',
		'}',
	];
	const expected = [
		'function test() {',
		'    ',
		'  return 1;',
		'}',
	];
	t.deepEqual(compressIndentation(input), expected);
});

test('compressIndentation - deeply nested code becomes compact', t => {
	const input = [
		'class Foo {',
		'\t\t\tdeepMethod() {',
		'\t\t\t\treturn this.value;',
		'\t\t\t}',
		'}',
	];
	const expected = [
		'class Foo {',
		'      deepMethod() {',
		'        return this.value;',
		'      }',
		'}',
	];
	t.deepEqual(compressIndentation(input), expected);
});

// === normalizeIndentation tests ===

test('normalizeIndentation - empty array returns empty array', t => {
	const result = normalizeIndentation([]);
	t.deepEqual(result, []);
});

test('normalizeIndentation - single line with no indentation', t => {
	const result = normalizeIndentation(['const x = 1;']);
	t.deepEqual(result, ['const x = 1;']);
});

test('normalizeIndentation - single line with indentation becomes unindented', t => {
	const result = normalizeIndentation(['    const x = 1;']);
	t.deepEqual(result, ['const x = 1;']);
});

test('normalizeIndentation - multiple lines with same indentation', t => {
	const input = ['    const x = 1;', '    const y = 2;', '    const z = 3;'];
	const expected = ['const x = 1;', 'const y = 2;', 'const z = 3;'];
	t.deepEqual(normalizeIndentation(input), expected);
});

test('normalizeIndentation - preserves relative indentation with spaces', t => {
	const input = [
		'    function test() {',
		'      return 1;',
		'    }',
	];
	const expected = [
		'function test() {',
		'  return 1;',
		'}',
	];
	t.deepEqual(normalizeIndentation(input), expected);
});

test('normalizeIndentation - preserves relative indentation with tabs', t => {
	const input = [
		'\t\tfunction test() {',
		'\t\t\treturn 1;',
		'\t\t}',
	];
	const expected = [
		'function test() {',
		'  return 1;', // Now uses 2 spaces instead of tab
		'}',
	];
	t.deepEqual(normalizeIndentation(input), expected);
});

test('normalizeIndentation - handles mixed indentation (tabs and spaces)', t => {
	const input = [
		'\t\tfunction test() {',
		'\t\t  return 1;', // 2 tabs + 2 spaces
		'\t\t}',
	];
	// Min indent is 2 tabs = 2 normalized units
	// Line 2 has 2 tabs + 2 spaces = 2 + 1 = 3 normalized units
	// Relative indent: 0, 1, 0
	// Always uses 2 spaces for display
	const expected = [
		'function test() {',
		'  return 1;',
		'}',
	];
	t.deepEqual(normalizeIndentation(input), expected);
});

test('normalizeIndentation - empty lines are preserved', t => {
	const input = [
		'    function test() {',
		'',
		'      return 1;',
		'    }',
	];
	const expected = [
		'function test() {',
		'',
		'  return 1;',
		'}',
	];
	t.deepEqual(normalizeIndentation(input), expected);
});

test('normalizeIndentation - handles space-indented code with no minimum indentation', t => {
	const input = [
		'function test() {',
		'  return 1;',
		'}',
	];
	// Already at 0 indentation with spaces, should convert to 2-space units
	const expected = [
		'function test() {',
		'  return 1;',
		'}',
	];
	t.deepEqual(normalizeIndentation(input), expected);
});

test('normalizeIndentation - converts tabs to spaces even when min indent is 0', t => {
	const input = [
		'}',
		'\t\tconst x = 1;',
		'\t\t\tconst y = 2;',
	];
	// Min indent is 0 (from '}'), but tabs must still be converted to 2-space units
	const expected = [
		'}',
		'    const x = 1;',
		'      const y = 2;',
	];
	t.deepEqual(normalizeIndentation(input), expected);
});

test('normalizeIndentation - deeply nested code', t => {
	const input = [
		'          if (condition) {',
		'            while (true) {',
		'              doSomething();',
		'            }',
		'          }',
	];
	const expected = [
		'if (condition) {',
		'  while (true) {',
		'    doSomething();',
		'  }',
		'}',
	];
	t.deepEqual(normalizeIndentation(input), expected);
});

test('normalizeIndentation - code with varying indentation levels', t => {
	const input = [
		'      const items = [',
		'        {id: 1},',
		'        {id: 2},',
		'      ];',
	];
	const expected = [
		'const items = [',
		'  {id: 1},',
		'  {id: 2},',
		'];',
	];
	t.deepEqual(normalizeIndentation(input), expected);
});

test('normalizeIndentation - all empty lines returns input', t => {
	const input = ['', '', ''];
	t.deepEqual(normalizeIndentation(input), input);
});

test('normalizeIndentation - handles odd number of spaces', t => {
	const input = [
		'     const x = 1;', // 5 spaces = 2 normalized units
		'       const y = 2;', // 7 spaces = 3 normalized units
	];
	// Min indent is 2 units
	// Relative: 0, 1
	const expected = [
		'const x = 1;',
		'  const y = 2;',
	];
	t.deepEqual(normalizeIndentation(input), expected);
});

test('normalizeIndentation - always uses 2 spaces for display', t => {
	const input = [
		'\t\tconst x = 1;',
		'\t\t\tconst y = 2;',
	];
	const result = normalizeIndentation(input);
	// Should use 2 spaces for relative indentation (not tabs)
	t.deepEqual(result, [
		'const x = 1;',
		'  const y = 2;',
	]);
});

test('normalizeIndentation - uses spaces when no tabs detected', t => {
	const input = [
		'    const x = 1;',
		'      const y = 2;',
	];
	const result = normalizeIndentation(input);
	// Should use 2 spaces for relative indentation
	t.deepEqual(result, [
		'const x = 1;',
		'  const y = 2;',
	]);
});

test('normalizeIndentation - JSX example with deep nesting', t => {
	const input = [
		'        return (',
		'          <div>',
		'            {items.map(item => (',
		'              <button onClick={() => handleClick(item.id)}>',
		'                {item.name}',
		'              </button>',
		'            ))}',
		'          </div>',
		'        );',
	];
	const expected = [
		'return (',
		'  <div>',
		'    {items.map(item => (',
		'      <button onClick={() => handleClick(item.id)}>',
		'        {item.name}',
		'      </button>',
		'    ))}',
		'  </div>',
		');',
	];
	t.deepEqual(normalizeIndentation(input), expected);
});

test('normalizeIndentation - handles whitespace-only lines as empty', t => {
	const input = [
		'    function test() {',
		'      ',
		'      return 1;',
		'    }',
	];
	const expected = [
		'function test() {',
		'      ', // Whitespace-only line preserved as-is
		'  return 1;',
		'}',
	];
	t.deepEqual(normalizeIndentation(input), expected);
});
