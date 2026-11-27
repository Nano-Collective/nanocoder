import {parse as parsePath} from 'node:path';
import {mkdirSync, mkdtempSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import test from 'ava';
import {setRestrictedScope} from '@/utils/restricted-scope';
import {
	resetSessionCwd,
	setProjectRoot,
	setSessionCwd,
} from '@/services/session-cwd';
import {
	validateEditableEncoding,
	validatePath,
	validatePathPair,
} from './path-validators';

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

test('validateEditableEncoding accepts a file that is valid UTF-8', t => {
	t.deepEqual(validateEditableEncoding('notes.txt', {notUtf8: false}), {
		valid: true,
	});
});

test('validateEditableEncoding refuses a file that is not valid UTF-8 (#1854)', t => {
	const result = validateEditableEncoding('legacy.txt', {notUtf8: true});
	t.false(result.valid);
	if (!result.valid) {
		t.true(result.error.includes('"legacy.txt"'));
		t.regex(result.error, /not valid UTF-8/);
		t.regex(result.error, /Do not retry/);
	}
});

// System-directory guard
//
// When the project root is a filesystem root, containment accepts every
// absolute path, so these paths are only rejected by the shared guard.

test.serial(
	'validatePath rejects a POSIX system directory when the project root is /',
	t => {
		if (process.platform === 'win32') {
			t.pass('POSIX-only system directories');
			return;
		}

		const fsRoot = parsePath(process.cwd()).root;
		setProjectRoot(fsRoot);
		setSessionCwd(fsRoot);
		try {
			const result = validatePath('/etc/passwd');
			t.false(result.valid);
			if (!result.valid) {
				t.true(result.error.includes('system directory'));
			}
		} finally {
			resetSessionCwd();
		}
	},
);

test.serial(
	'validatePath rejects a relative path that resolves into a system directory',
	t => {
		if (process.platform === 'win32') {
			t.pass('POSIX-only system directories');
			return;
		}

		const fsRoot = parsePath(process.cwd()).root;
		setProjectRoot(fsRoot);
		setSessionCwd(fsRoot);
		try {
			const result = validatePath('etc/passwd');
			t.false(result.valid);
			if (!result.valid) {
				t.true(result.error.includes('system directory'));
			}
		} finally {
			resetSessionCwd();
		}
	},
);

test.serial('validatePath allows a sibling whose name shares a system prefix', t => {
	if (process.platform === 'win32') {
		t.pass('POSIX-only system directories');
		return;
	}

	const fsRoot = parsePath(process.cwd()).root;
	setProjectRoot(fsRoot);
	setSessionCwd(fsRoot);
	try {
		const result = validatePath('/etcetera/notes.txt');
		t.deepEqual(result, {valid: true});
	} finally {
		resetSessionCwd();
	}
});

test.serial(
	'validatePathPair rejects a system-directory destination under a filesystem root',
	t => {
		if (process.platform === 'win32') {
			t.pass('POSIX-only system directories');
			return;
		}

		const fsRoot = parsePath(process.cwd()).root;
		setProjectRoot(fsRoot);
		setSessionCwd(fsRoot);
		try {
			const result = validatePathPair('tmp/source.txt', '/etc/passwd');
			t.false(result.valid);
			if (!result.valid) {
				t.true(result.error.includes('system directory'));
			}
		} finally {
			resetSessionCwd();
		}
	},
);

test.serial(
	'validatePathPair allows a system-directory source (read) under a filesystem root',
	t => {
		if (process.platform === 'win32') {
			t.pass('POSIX-only system directories');
			return;
		}

		const fsRoot = parsePath(process.cwd()).root;
		setProjectRoot(fsRoot);
		setSessionCwd(fsRoot);
		try {
			// Source is only read during copy/move, so the system-directory
			// write guard must not reject it. Destination is a normal path.
			const result = validatePathPair('/etc/passwd', '/tmp/copied.txt');
			t.deepEqual(result, {valid: true});
		} finally {
			resetSessionCwd();
		}
	},
)

test.serial(
	'validatePathPair rejects a move source from a system directory under a filesystem root',
	t => {
		if (process.platform === 'win32') {
			t.pass('POSIX-only system directories');
			return;
		}

		const fsRoot = parsePath(process.cwd()).root;
		setProjectRoot(fsRoot);
		setSessionCwd(fsRoot);
		try {
			// Moving from a system directory is a write to that directory,
			// so it must be rejected.
			const result = validatePathPair('/etc/passwd', '/tmp/moved.txt', true);
			t.false(result.valid);
			if (!result.valid) {
				t.true(result.error.includes('system directory'));
			}
		} finally {
			resetSessionCwd();
		}
	},
)

test.serial(
	'validatePathPair allows a copy source from a system directory under a filesystem root',
	t => {
		if (process.platform === 'win32') {
			t.pass('POSIX-only system directories');
			return;
		}

		const fsRoot = parsePath(process.cwd()).root;
		setProjectRoot(fsRoot);
		setSessionCwd(fsRoot);
		try {
			// Copy only reads from the source; the destination is what matters.
			const result = validatePathPair('/etc/passwd', '/tmp/copied.txt', false);
			t.deepEqual(result, {valid: true});
		} finally {
			resetSessionCwd();
		}
	},
)

test.serial(
	'validatePath rejects a Windows system directory when the project root is a drive root',
	t => {
		if (process.platform !== 'win32') {
			t.pass('Windows-only system directories');
			return;
		}

		setProjectRoot('C:\\');
		setSessionCwd('C:\\');
		try {
			const result = validatePath('C:\\Windows\\System32\\test.exe');
			t.false(result.valid);
			if (!result.valid) {
				t.true(result.error.includes('system directory'));
			}
		} finally {
			resetSessionCwd();
		}
	},
);

test.serial('restricted scope limits writes and moves', t => {
	t.teardown(() => setRestrictedScope(undefined));
	setRestrictedScope(['source/utils/', 'README.md']);

	t.true(validatePath('source/utils/new.ts').valid);
	t.true(validatePath('README.md').valid);
	const outside = validatePath('source/cli.tsx');
	t.false(outside.valid);
	t.regex(
		outside.valid ? '' : outside.error,
		/outside the paths this run may edit: source\/utils, README\.md/,
	);
	t.false(validatePath('source/utils/../cli.tsx').valid);

	t.false(validatePathPair('README.md', 'other.md', false).valid);
	t.true(validatePathPair('package.json', 'source/utils/p.json', false).valid);
	t.false(validatePathPair('package.json', 'source/utils/p.json', true).valid);
});

test.serial('restricted scope follows symlinks', t => {
	if (process.platform === 'win32') {
		t.pass();
		return;
	}
	const previous = process.cwd();
	const dir = mkdtempSync(`${tmpdir()}/nanocoder-scope-`);
	t.teardown(() => {
		setRestrictedScope(undefined);
		process.chdir(previous);
		rmSync(dir, {recursive: true, force: true});
	});
	mkdirSync(`${dir}/allowed`);
	mkdirSync(`${dir}/private`);
	symlinkSync(`${dir}/private`, `${dir}/allowed/link`);
	process.chdir(dir);
	setRestrictedScope(['allowed']);

	t.true(validatePath('allowed/file.ts').valid);
	t.false(validatePath('allowed/link/file.ts').valid);
});
