import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'ava';
import {DEFAULT_IGNORE_DIRS, loadGitignore} from './gitignore-loader';

test('loadGitignore returns ignore instance', t => {
	const ig = loadGitignore(process.cwd());
	t.truthy(ig);
	t.is(typeof ig.ignores, 'function');
});

test('loadGitignore ignores default directories', t => {
	const ig = loadGitignore(process.cwd());
	for (const dir of DEFAULT_IGNORE_DIRS) {
		t.true(ig.ignores(dir), `Should ignore ${dir}`);
		t.true(ig.ignores(`${dir}/file.ts`), `Should ignore ${dir}/file.ts`);
	}
});

test('DEFAULT_IGNORE_DIRS contains expected directories', t => {
	// JavaScript/TypeScript/Node.js
	t.true(DEFAULT_IGNORE_DIRS.includes('node_modules'));
	t.true(DEFAULT_IGNORE_DIRS.includes('.cache'));

	// Build outputs
	t.true(DEFAULT_IGNORE_DIRS.includes('dist'));
	t.true(DEFAULT_IGNORE_DIRS.includes('build'));
	t.true(DEFAULT_IGNORE_DIRS.includes('out'));

	// Framework-specific
	t.true(DEFAULT_IGNORE_DIRS.includes('.next'));
	t.true(DEFAULT_IGNORE_DIRS.includes('.nuxt'));

	// Python
	t.true(DEFAULT_IGNORE_DIRS.includes('__pycache__'));
	t.true(DEFAULT_IGNORE_DIRS.includes('.pytest_cache'));

	// Rust/Java
	t.true(DEFAULT_IGNORE_DIRS.includes('target'));

	// Test coverage
	t.true(DEFAULT_IGNORE_DIRS.includes('coverage'));

	// Version control
	t.true(DEFAULT_IGNORE_DIRS.includes('.git'));
	t.true(DEFAULT_IGNORE_DIRS.includes('.svn'));
	t.true(DEFAULT_IGNORE_DIRS.includes('.hg'));

	// Verify count
	t.is(DEFAULT_IGNORE_DIRS.length, 14);
});

test.serial('loadGitignore loads .gitignore patterns', async t => {
	const testDir = join(process.cwd(), 'test-gitignore-loader-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, '.gitignore'), '*.log\ntmp/\n');

		const ig = loadGitignore(testDir);

		t.true(ig.ignores('file.log'), 'Should ignore .log files');
		t.true(ig.ignores('tmp/file.txt'), 'Should ignore tmp/ directory');
		t.false(ig.ignores('file.ts'), 'Should not ignore .ts files');
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('loadGitignore works without .gitignore file', async t => {
	const testDir = join(process.cwd(), 'test-gitignore-no-file-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		// No .gitignore file

		const ig = loadGitignore(testDir);

		// Should still have default ignores
		t.true(ig.ignores('node_modules/file.js'));
		t.false(ig.ignores('src/file.ts'));
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('loadGitignore loads .nanocoderignore patterns', async t => {
	const testDir = join(process.cwd(), 'test-nanocoderignore-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, '.nanocoderignore'), '*.secret\ndata/\n');

		const ig = loadGitignore(testDir);

		t.true(ig.ignores('api.secret'), 'Should ignore .secret files');
		t.true(ig.ignores('data/dump.csv'), 'Should ignore data/ directory');
		t.false(ig.ignores('file.ts'), 'Should not ignore unrelated files');
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial(
	'loadGitignore merges .gitignore and .nanocoderignore patterns',
	async t => {
		const testDir = join(process.cwd(), 'test-both-ignores-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			writeFileSync(join(testDir, '.gitignore'), '*.log\n');
			writeFileSync(join(testDir, '.nanocoderignore'), '.env\npackage-lock.json\n');

			const ig = loadGitignore(testDir);

			t.true(ig.ignores('file.log'), 'Should ignore .gitignore patterns');
			t.true(ig.ignores('.env'), 'Should ignore .nanocoderignore patterns');
			t.true(
				ig.ignores('package-lock.json'),
				'Should ignore committed files listed in .nanocoderignore',
			);
			t.false(ig.ignores('file.ts'), 'Should not ignore unrelated files');
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial('loadGitignore works without .nanocoderignore file', async t => {
	const testDir = join(process.cwd(), 'test-no-nanocoderignore-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		// No .nanocoderignore file

		const ig = loadGitignore(testDir);

		// Should still have default ignores and not throw
		t.true(ig.ignores('node_modules/file.js'));
		t.false(ig.ignores('src/file.ts'));
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test('loadGitignore ignores all language-specific directories', t => {
	const ig = loadGitignore(process.cwd());

	// Python
	t.true(ig.ignores('__pycache__'));
	t.true(ig.ignores('src/__pycache__/file.pyc'));
	t.true(ig.ignores('.pytest_cache'));
	t.true(ig.ignores('.pytest_cache/file'));

	// Rust/Java
	t.true(ig.ignores('target'));
	t.true(ig.ignores('target/debug/app'));

	// Version control
	t.true(ig.ignores('.svn'));
	t.true(ig.ignores('.svn/entries'));
	t.true(ig.ignores('.hg'));
	t.true(ig.ignores('.hg/store'));
});
