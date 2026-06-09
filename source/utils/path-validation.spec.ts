import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {isValidFilePath, resolveFilePath} from './path-validation';

// Test suite for isValidFilePath
test('isValidFilePath: accepts simple relative paths', (t) => {
	t.true(isValidFilePath('file.txt'));
	t.true(isValidFilePath('src/app.tsx'));
	t.true(isValidFilePath('src/components/Button.tsx'));
	t.true(isValidFilePath('deep/nested/path/to/file.js'));
});

test('isValidFilePath: accepts paths with special characters', (t) => {
	t.true(isValidFilePath('file-name.txt'));
	t.true(isValidFilePath('file_name.txt'));
	t.true(isValidFilePath('file.test.spec.ts'));
	t.true(isValidFilePath('src/@types/index.d.ts'));
});

test('isValidFilePath: rejects empty paths', (t) => {
	t.false(isValidFilePath(''));
	t.false(isValidFilePath('   '));
	t.false(isValidFilePath('\t'));
});

test('isValidFilePath: rejects directory traversal attempts', (t) => {
	t.false(isValidFilePath('../file.txt'));
	t.false(isValidFilePath('../../etc/passwd'));
	t.false(isValidFilePath('src/../../../etc/passwd'));
	t.false(isValidFilePath('..'));
	t.false(isValidFilePath('../'));
});

test('isValidFilePath: rejects absolute Unix paths', (t) => {
	t.false(isValidFilePath('/etc/passwd'));
	t.false(isValidFilePath('/home/user/file.txt'));
	t.false(isValidFilePath('/usr/bin/bash'));
	t.false(isValidFilePath('/'));
});

test('isValidFilePath: rejects absolute Windows paths', (t) => {
	t.false(isValidFilePath('C:\\Windows\\System32'));
	t.false(isValidFilePath('C:\\Users\\user\\file.txt'));
	t.false(isValidFilePath('D:\\data\\file.txt'));
	t.false(isValidFilePath('c:\\windows\\file.txt')); // lowercase drive letter
});

test('isValidFilePath: rejects paths with null bytes', (t) => {
	t.false(isValidFilePath('file\0.txt'));
	t.false(isValidFilePath('src/\0/file.txt'));
	t.false(isValidFilePath('\0'));
});

test('isValidFilePath: rejects home directory shorthand paths', (t) => {
	t.false(isValidFilePath('~/file.txt'));
	t.false(isValidFilePath('~/Documents/project/file.txt'));
	t.false(isValidFilePath('~'));
});

test('isValidFilePath: rejects paths starting with separators', (t) => {
	t.false(isValidFilePath('/file.txt'));
	t.false(isValidFilePath('\\file.txt'));
});

test('isValidFilePath: accepts Next.js dynamic route paths with brackets', (t) => {
	t.true(isValidFilePath('app/[project]/page.tsx'));
	t.true(isValidFilePath('app/[project]/docs/[version]/page.tsx'));
	t.true(isValidFilePath('app/[project]/docs/[version]/[[...slug]]/page.tsx'));
	t.true(isValidFilePath('app/[...catchAll]/page.tsx'));
});

test('isValidFilePath: accepts hidden files (starting with dot)', (t) => {
	t.true(isValidFilePath('.gitignore'));
	t.true(isValidFilePath('.github/workflows/ci.yml'));
	t.true(isValidFilePath('src/.env'));
});

// Test suite for resolveFilePath
test('resolveFilePath: resolves simple relative paths', (t) => {
	const cwd = '/home/user/project';
	const result = resolveFilePath('src/app.tsx', cwd);
	t.is(result, join(cwd, 'src/app.tsx'));
});

test('resolveFilePath: resolves nested paths', (t) => {
	const cwd = '/home/user/project';
	const result = resolveFilePath('src/components/Button.tsx', cwd);
	t.is(result, join(cwd, 'src/components/Button.tsx'));
});

test('resolveFilePath: throws on invalid paths', (t) => {
	const cwd = '/home/user/project';

	t.throws(
		() => resolveFilePath('../etc/passwd', cwd),
		{message: /Invalid file path/},
		'Should reject directory traversal',
	);

	t.throws(
		() => resolveFilePath('/etc/passwd', cwd),
		{message: /Invalid file path/},
		'Should reject absolute paths',
	);

	t.throws(
		() => resolveFilePath('', cwd),
		{message: /Invalid file path/},
		'Should reject empty paths',
	);
});

test('resolveFilePath: prevents escape via path resolution', (t) => {
	const cwd = '/home/user/project';

	// Even though '../secret.txt' passes basic validation when considered alone,
	// isValidFilePath will reject it because it contains '..'
	t.throws(
		() => resolveFilePath('../secret.txt', cwd),
		{message: /Invalid file path/},
	);
});

test('resolveFilePath: ensures resolved path stays within project', (t) => {
	const cwd = '/home/user/project';

	// Valid relative path
	const result1 = resolveFilePath('src/file.txt', cwd);
	t.true(result1.startsWith(cwd), 'Resolved path should be within project');

	// Path with ./ prefix (should work)
	const result2 = resolveFilePath('./src/file.txt', cwd);
	t.true(result2.startsWith(cwd), 'Resolved path should be within project');
});

test('resolveFilePath: handles different working directories', (t) => {
	const cwdUnix = '/home/user/my-project';
	const result = resolveFilePath('src/index.ts', cwdUnix);
	t.is(result, join(cwdUnix, 'src/index.ts'));
});

test('resolveFilePath: rejects null byte injection', (t) => {
	const cwd = '/home/user/project';

	t.throws(
		() => resolveFilePath('file\0.txt', cwd),
		{message: /Invalid file path/},
	);
});

test('resolveFilePath: accepts hidden files', (t) => {
	const cwd = '/home/user/project';
	const result = resolveFilePath('.gitignore', cwd);
	t.is(result, join(cwd, '.gitignore'));
});

test('resolveFilePath: accepts paths with special characters', (t) => {
	const cwd = '/home/user/project';

	const result1 = resolveFilePath('my-file.txt', cwd);
	t.is(result1, join(cwd, 'my-file.txt'));

	const result2 = resolveFilePath('my_file.test.spec.ts', cwd);
	t.is(result2, join(cwd, 'my_file.test.spec.ts'));

	const result3 = resolveFilePath('src/@types/index.d.ts', cwd);
	t.is(result3, join(cwd, 'src/@types/index.d.ts'));
});

// Security-focused edge case tests
test('security: prevents various directory traversal techniques', (t) => {
	t.false(isValidFilePath('../../../../../etc/passwd'));
	t.false(isValidFilePath('..\\..\\..\\windows\\system32'));
	t.false(isValidFilePath('legitimate/../../etc/passwd'));
});

test('security: prevents absolute path variations', (t) => {
	t.false(isValidFilePath('/etc/passwd'));
	t.false(isValidFilePath('//etc/passwd'));
	t.false(isValidFilePath('\\etc\\passwd'));
	t.false(isValidFilePath('C:/Windows/System32'));
	t.false(isValidFilePath('C:\\Windows\\System32'));
	t.false(isValidFilePath('~/Documents/secret.txt'));
});

test('security: prevents null byte injection variations', (t) => {
	t.false(isValidFilePath('file.txt\0'));
	t.false(isValidFilePath('\0file.txt'));
	t.false(isValidFilePath('path/to\0/file.txt'));
});

test('security: ensures resolveFilePath maintains project boundaries', (t) => {
	const cwd = '/home/user/project';

	// All of these should throw because they're invalid
	const attackVectors = [
		'../../../etc/passwd',
		'/etc/passwd',
		'C:\\Windows\\System32',
	];

	for (const vector of attackVectors) {
		t.throws(() => resolveFilePath(vector, cwd), {
			message: /Invalid file path/,
		});
	}
});

// Symlink-aware containment (requires a real filesystem)
test.serial('security: rejects an in-project symlink whose target escapes', t => {
	const base = mkdtempSync(join(tmpdir(), 'pathval-'));
	try {
		const project = join(base, 'project');
		const outside = join(base, 'outside');
		mkdirSync(project);
		mkdirSync(outside);
		writeFileSync(join(outside, 'secret.txt'), 'secret');
		// A symlink inside the project that points outside it.
		symlinkSync(outside, join(project, 'link'));

		// Lexically `link/secret.txt` looks contained, but its real target is
		// outside the project — must be rejected.
		t.throws(() => resolveFilePath('link/secret.txt', project), {
			message: /escapes project directory via symlink/,
		});
		// Writing through the symlinked directory directly is also rejected.
		t.throws(() => resolveFilePath('link/new.txt', project), {
			message: /escapes project directory via symlink/,
		});
	} finally {
		rmSync(base, {recursive: true, force: true});
	}
});

test.serial('security: allows an in-project symlink that stays inside', t => {
	const base = mkdtempSync(join(tmpdir(), 'pathval-'));
	try {
		const project = join(base, 'project');
		mkdirSync(join(project, 'real'), {recursive: true});
		symlinkSync(join(project, 'real'), join(project, 'link'));

		// link -> project/real, which is inside the project: allowed.
		const resolved = resolveFilePath('link/ok.txt', project);
		t.is(resolved, join(project, 'link/ok.txt'));
	} finally {
		rmSync(base, {recursive: true, force: true});
	}
});

test.serial('resolveFilePath: resolves real files within a real project root', t => {
	const base = mkdtempSync(join(tmpdir(), 'pathval-'));
	try {
		mkdirSync(join(base, 'src'), {recursive: true});
		writeFileSync(join(base, 'src', 'app.ts'), '');
		const resolved = resolveFilePath('src/app.ts', base);
		// Returned path is the lexical absolute path (symlinks are resolved only
		// for the containment check, not for the returned value).
		t.is(resolved, join(base, 'src/app.ts'));
	} finally {
		rmSync(base, {recursive: true, force: true});
	}
});
