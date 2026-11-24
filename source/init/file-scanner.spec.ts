import { writeFileSync, rmSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import test from 'ava';
import { FileScanner } from './file-scanner';

// Create a temporary test directory
const testDir = join(tmpdir(), `nanocoder-file-scanner-test-${Date.now()}`);

test.before(() => {
	// Create test directory structure
	mkdirSync(testDir, {recursive: true});
	mkdirSync(join(testDir, 'src'), {recursive: true});
	mkdirSync(join(testDir, 'test'), {recursive: true});
	mkdirSync(join(testDir, 'docs'), {recursive: true});
});

test.after.always(() => {
	// Clean up test directory
	if (existsSync(testDir)) {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test('FileScanner - constructor initializes with root path', t => {
	const scanner = new FileScanner(testDir);

	t.truthy(scanner);
});

test('FileScanner - scan returns ScanResult structure', t => {
	const scanner = new FileScanner(testDir);

	const result = scanner.scan();

	t.true(Array.isArray(result.files));
	t.true(Array.isArray(result.directories));
	t.is(typeof result.totalFiles, 'number');
	t.is(typeof result.scannedFiles, 'number');
});

test('FileScanner - scan finds files in directory', t => {
	// Create some test files
	writeFileSync(join(testDir, 'package.json'), '{}', 'utf-8');
	writeFileSync(join(testDir, 'README.md'), '# Test', 'utf-8');
	writeFileSync(join(testDir, 'src', 'index.ts'), 'test', 'utf-8');

	const scanner = new FileScanner(testDir);
	const result = scanner.scan();

	t.true(result.files.includes('package.json'));
	t.true(result.files.includes('README.md'));
	t.true(result.files.includes('src/index.ts'));
});

test('FileScanner - scan finds directories', t => {
	const scanner = new FileScanner(testDir);
	const result = scanner.scan();

	t.true(result.directories.includes('src'));
	t.true(result.directories.includes('test'));
	t.true(result.directories.includes('docs'));
});

test('FileScanner - scan ignores node_modules directory', t => {
	// Create node_modules directory
	mkdirSync(join(testDir, 'node_modules'), {recursive: true});
	mkdirSync(join(testDir, 'node_modules', 'package'), {recursive: true});
	writeFileSync(join(testDir, 'node_modules', 'package', 'test'), 'test', 'utf-8');

	const scanner = new FileScanner(testDir);
	const result = scanner.scan();

	// node_modules should not be in files or directories
	t.false(result.files.some(f => f.includes('node_modules')));
	t.false(result.directories.some(d => d.includes('node_modules')));
});

test('FileScanner - scan ignores .git directory', t => {
	// Create .git directory
	mkdirSync(join(testDir, '.git'), {recursive: true});
	writeFileSync(join(testDir, '.git', 'config'), 'test', 'utf-8');

	const scanner = new FileScanner(testDir);
	const result = scanner.scan();

	t.false(result.files.some(f => f.includes('.git')));
	t.false(result.directories.some(d => d.includes('.git')));
});

test('FileScanner - scan ignores dist directory', t => {
	// Create dist directory
	mkdirSync(join(testDir, 'dist'), {recursive: true});
	writeFileSync(join(testDir, 'dist', 'bundle.js'), 'test', 'utf-8');

	const scanner = new FileScanner(testDir);
	const result = scanner.scan();

	t.false(result.files.some(f => f.includes('dist')));
	t.false(result.directories.some(d => d.includes('dist')));
});

test('FileScanner - scan respects .gitignore patterns', t => {
	// Create .gitignore file
	writeFileSync(join(testDir, '.gitignore'), '*.log\ntemp/\n.cache', 'utf-8');

	// Create files that should be ignored
	writeFileSync(join(testDir, 'debug.log'), 'log', 'utf-8');
	mkdirSync(join(testDir, 'temp'), {recursive: true});
	writeFileSync(join(testDir, 'temp', 'file.txt'), 'test', 'utf-8');

	const scanner = new FileScanner(testDir);
	const result = scanner.scan();

	// These files should be ignored
	t.false(result.files.includes('debug.log'));
	t.false(result.files.some(f => f.includes('temp')));
});

test('FileScanner - getFilesByPattern filters files by pattern', t => {
	// Create various files
	writeFileSync(join(testDir, 'package.json'), '{}', 'utf-8');
	writeFileSync(join(testDir, 'tsconfig.json'), '{}', 'utf-8');
	writeFileSync(join(testDir, 'README.md'), '# Test', 'utf-8');
	writeFileSync(join(testDir, 'src', 'index.ts'), 'test', 'utf-8');

	const scanner = new FileScanner(testDir);
	const jsonFiles = scanner.getFilesByPattern(['*.json']);

	t.true(jsonFiles.includes('package.json'));
	t.true(jsonFiles.includes('tsconfig.json'));
	t.false(jsonFiles.includes('README.md'));
	t.false(jsonFiles.includes('src/index.ts'));
});

test('FileScanner - getFilesByPattern with multiple patterns', t => {
	// Create files
	writeFileSync(join(testDir, 'README.md'), '# Test', 'utf-8');
	writeFileSync(join(testDir, 'CHANGELOG.md'), '# Changelog', 'utf-8');
	writeFileSync(join(testDir, 'package.json'), '{}', 'utf-8');
	writeFileSync(join(testDir, 'src', 'index.ts'), 'test', 'utf-8');

	const scanner = new FileScanner(testDir);
	const docsAndConfig = scanner.getFilesByPattern(['*.md', '*.json']);

	t.true(docsAndConfig.includes('README.md'));
	t.true(docsAndConfig.includes('CHANGELOG.md'));
	t.true(docsAndConfig.includes('package.json'));
	t.false(docsAndConfig.includes('src/index.ts'));
});

test('FileScanner - getProjectFiles returns categorized files', t => {
	// Create various project files
	writeFileSync(join(testDir, 'package.json'), '{}', 'utf-8');
	writeFileSync(join(testDir, 'README.md'), '# Test', 'utf-8');
	writeFileSync(join(testDir, 'Makefile'), 'build:', 'utf-8');
	writeFileSync(join(testDir, 'test', 'index.spec.ts'), 'test', 'utf-8');
	writeFileSync(join(testDir, 'tsconfig.json'), '{}', 'utf-8');

	const scanner = new FileScanner(testDir);
	const projectFiles = scanner.getProjectFiles();

	t.true(Array.isArray(projectFiles.config));
	t.true(Array.isArray(projectFiles.documentation));
	t.true(Array.isArray(projectFiles.build));
	t.true(Array.isArray(projectFiles.test));

	t.true(projectFiles.config.includes('package.json'));
	// tsconfig.json is in build files, not config
	t.true(projectFiles.build.includes('tsconfig.json'));
	t.true(projectFiles.documentation.includes('README.md'));
	t.true(projectFiles.build.includes('Makefile'));
	t.true(projectFiles.test.some(f => f.includes('index.spec')));
});

test('FileScanner - scan handles empty directory', t => {
	const emptyDir = join(testDir, 'empty');
	mkdirSync(emptyDir, {recursive: true});

	const scanner = new FileScanner(emptyDir);
	const result = scanner.scan();

	t.is(result.files.length, 0);
	t.is(result.directories.length, 0);
});

test('FileScanner - scan counts files correctly', t => {
	// Create some files
	writeFileSync(join(testDir, 'file1.txt'), 'test', 'utf-8');
	writeFileSync(join(testDir, 'file2.txt'), 'test', 'utf-8');
	writeFileSync(join(testDir, 'file3.txt'), 'test', 'utf-8');

	const scanner = new FileScanner(testDir);
	const result = scanner.scan();

	// Note: totalFiles includes both files and directories
	t.true(result.totalFiles >= 3);
	t.true(result.scannedFiles >= 3);
});

test('FileScanner - getFilesByPattern with docs pattern', t => {
	// Create documentation files
	writeFileSync(join(testDir, 'README.md'), '# Test', 'utf-8');
	writeFileSync(join(testDir, 'docs', 'guide.md'), '# Guide', 'utf-8');
	writeFileSync(join(testDir, 'src', 'index.ts'), 'test', 'utf-8');

	const scanner = new FileScanner(testDir);
	const docPatterns = ['README*', '*.md', 'docs/*'];
	const docs = scanner.getFilesByPattern(docPatterns);

	t.true(docs.includes('README.md'));
	t.true(docs.some(f => f.includes('docs/guide.md')));
});

test('FileScanner - scan handles subdirectories', t => {
	// Create nested structure
	mkdirSync(join(testDir, 'src', 'components'), {recursive: true});
	writeFileSync(join(testDir, 'src', 'index.ts'), 'test', 'utf-8');
	writeFileSync(join(testDir, 'src', 'components', 'Button.tsx'), 'test', 'utf-8');

	const scanner = new FileScanner(testDir);
	const result = scanner.scan();

	t.true(result.files.includes('src/index.ts'));
	t.true(result.files.includes('src/components/Button.tsx'));
	t.true(result.directories.includes('src/components'));
});

// A backslash is a path separator on Windows, so this name cannot exist there
(process.platform === 'win32' ? test.skip : test)(
	'FileScanner - scan keeps a backslash in a file name',
	t => {
		writeFileSync(join(testDir, 'src', 'we\\ird.txt'), 'test', 'utf-8');

		const scanner = new FileScanner(testDir);
		const result = scanner.scan();

		t.true(result.files.includes('src/we\\ird.txt'));
	},
);

test('FileScanner - scan ignores .svn directory', t => {
	mkdirSync(join(testDir, '.svn'), {recursive: true});
	writeFileSync(join(testDir, '.svn', 'entries'), 'test', 'utf-8');

	const scanner = new FileScanner(testDir);
	const result = scanner.scan();

	t.false(result.files.some(f => f.includes('.svn')));
	t.false(result.directories.some(d => d.includes('.svn')));
});

test('FileScanner - scan ignores .hg directory', t => {
	mkdirSync(join(testDir, '.hg'), {recursive: true});
	writeFileSync(join(testDir, '.hg', 'store'), 'test', 'utf-8');

	const scanner = new FileScanner(testDir);
	const result = scanner.scan();

	t.false(result.files.some(f => f.includes('.hg')));
	t.false(result.directories.some(d => d.includes('.hg')));
});

test('FileScanner - scan ignores __pycache__ directory', t => {
	mkdirSync(join(testDir, '__pycache__'), {recursive: true});
	writeFileSync(join(testDir, '__pycache__', 'module.pyc'), 'test', 'utf-8');

	const scanner = new FileScanner(testDir);
	const result = scanner.scan();

	t.false(result.files.some(f => f.includes('__pycache__')));
	t.false(result.directories.some(d => d.includes('__pycache__')));
});

test('FileScanner - scan ignores .pytest_cache directory', t => {
	mkdirSync(join(testDir, '.pytest_cache'), {recursive: true});
	writeFileSync(join(testDir, '.pytest_cache', 'cache'), 'test', 'utf-8');

	const scanner = new FileScanner(testDir);
	const result = scanner.scan();

	t.false(result.files.some(f => f.includes('.pytest_cache')));
	t.false(result.directories.some(d => d.includes('.pytest_cache')));
});

test('FileScanner - scan ignores target directory', t => {
	mkdirSync(join(testDir, 'target'), {recursive: true});
	mkdirSync(join(testDir, 'target', 'debug'), {recursive: true});
	writeFileSync(join(testDir, 'target', 'debug', 'app'), 'test', 'utf-8');

	const scanner = new FileScanner(testDir);
	const result = scanner.scan();

	t.false(result.files.some(f => f.includes('target')));
	t.false(result.directories.some(d => d.includes('target')));
});