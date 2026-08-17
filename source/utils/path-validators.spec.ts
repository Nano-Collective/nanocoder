import test from 'ava';
import {validatePath, validatePathPair} from './path-validators';

// validatePath

test('validatePath accepts a valid relative path', t => {
	const result = validatePath('source/utils/test.ts');
	t.deepEqual(result, {valid: true});
});

test('validatePath rejects an absolute path outside project', t => {
	const result = validatePath('/etc/passwd');
	t.false(result.valid);
	if (!result.valid) {
		t.true(result.error.includes('Invalid file path'));
	}
});

test('validatePath rejects empty path', t => {
	const result = validatePath('');
	t.false(result.valid);
});

test('validatePath rejects path with directory traversal', t => {
	const result = validatePath('../../../etc/passwd');
	t.false(result.valid);
});

// validatePathPair

test('validatePathPair accepts two valid relative paths', t => {
	const result = validatePathPair('source/a.ts', 'source/b.ts');
	t.deepEqual(result, {valid: true});
});

test('validatePathPair rejects invalid source path', t => {
	const result = validatePathPair('/etc/passwd', 'source/b.ts');
	t.false(result.valid);
	if (!result.valid) {
		t.true(result.error.includes('source path'));
	}
});

test('validatePathPair rejects invalid destination path', t => {
	const result = validatePathPair('source/a.ts', '/etc/passwd');
	t.false(result.valid);
	if (!result.valid) {
		t.true(result.error.includes('destination path'));
	}
});

test('validatePathPair rejects both invalid paths with source error first', t => {
	const result = validatePathPair('/etc/a', '/etc/b');
	t.false(result.valid);
	if (!result.valid) {
		t.true(result.error.includes('source path'));
	}
});

// Restricted Scope Tests
test('validatePath respects restrictedScope when path is inside', t => {
	// The path must be valid within the project root first.
	// We'll use a relative path which resolves inside the project root.
	const result = validatePath('source/utils/test.ts', {
		restrictedScope: 'source/utils'
	});
	t.deepEqual(result, {valid: true});
});

test('validatePath rejects when path is outside restrictedScope', t => {
	const result = validatePath('source/components/test.ts', {
		restrictedScope: 'source/utils'
	});
	t.false(result.valid);
	if (!result.valid) {
		t.true(result.error.includes('Path escapes restricted scope'));
	}
});

test('validatePath respects restrictedScope array when path is inside', t => {
	const result = validatePath('source/components/test.ts', {
		restrictedScope: ['source/utils', 'source/components']
	});
	t.deepEqual(result, {valid: true});
});

test('validatePathPair respects restrictedScope when both are inside', t => {
	const result = validatePathPair('source/utils/a.ts', 'source/utils/b.ts', {
		restrictedScope: 'source/utils'
	});
	t.deepEqual(result, {valid: true});
});

test('validatePathPair rejects when source is outside restrictedScope', t => {
	const result = validatePathPair('source/components/a.ts', 'source/utils/b.ts', {
		restrictedScope: 'source/utils'
	});
	t.false(result.valid);
	if (!result.valid) {
		t.true(result.error.includes('Path escapes restricted scope'));
	}
});

test('validatePathPair rejects when destination is outside restrictedScope', t => {
	const result = validatePathPair('source/utils/a.ts', 'source/components/b.ts', {
		restrictedScope: 'source/utils'
	});
	t.false(result.valid);
	if (!result.valid) {
		t.true(result.error.includes('Path escapes restricted scope'));
	}
});
