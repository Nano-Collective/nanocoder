import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {walkDirectory} from './directory-walker';

test('walkDirectory walks breadth-first so large sibling folders do not starve other folders', async t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-walker-bfs-'));
	t.teardown(() => {
		rmSync(dir, {recursive: true, force: true});
	});

	// Create root with big/ (holding 30 files) and src/ (holding 1 file)
	mkdirSync(join(dir, 'big'), {recursive: true});
	mkdirSync(join(dir, 'src'), {recursive: true});

	for (let i = 1; i <= 30; i++) {
		writeFileSync(join(dir, 'big', `f${i}.ts`), 'content');
	}
	writeFileSync(join(dir, 'src', 'app.ts'), 'content');

	// Set maxEntries to 10 (less than 30)
	const result = await walkDirectory({
		root: dir,
		dirPath: dir,
		recursive: true,
		maxDepth: 3,
		maxEntries: 10,
	});

	t.true(result.hitCap);
	t.is(result.entries.length, 10);

	// Because of breadth-first traversal, level 0 entries ('big' and 'src')
	// are visited before descending into 'big/'!
	const relPaths = result.entries.map(e => e.relativePath);
	t.true(relPaths.includes('big'));
	t.true(relPaths.includes('src'));
});

test('walkDirectory recursive=false only lists depth 0', async t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-walker-nonrec-'));
	t.teardown(() => {
		rmSync(dir, {recursive: true, force: true});
	});

	mkdirSync(join(dir, 'sub'), {recursive: true});
	writeFileSync(join(dir, 'root.txt'), 'hello');
	writeFileSync(join(dir, 'sub', 'nested.txt'), 'nested');

	const result = await walkDirectory({
		root: dir,
		dirPath: dir,
		recursive: false,
	});

	const relPaths = result.entries.map(e => e.relativePath);
	t.true(relPaths.includes('sub'));
	t.true(relPaths.includes('root.txt'));
	t.false(relPaths.includes('sub/nested.txt'));
});

test('walkDirectory respects maxDepth', async t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-walker-depth-'));
	t.teardown(() => {
		rmSync(dir, {recursive: true, force: true});
	});

	mkdirSync(join(dir, 'd1', 'd2', 'd3', 'd4'), {recursive: true});
	writeFileSync(join(dir, 'd1', 'f1.txt'), '1');
	writeFileSync(join(dir, 'd1', 'd2', 'f2.txt'), '2');
	writeFileSync(join(dir, 'd1', 'd2', 'd3', 'f3.txt'), '3');
	writeFileSync(join(dir, 'd1', 'd2', 'd3', 'd4', 'f4.txt'), '4');

	const result = await walkDirectory({
		root: dir,
		dirPath: dir,
		recursive: true,
		maxDepth: 3,
	});

	const relPaths = result.entries.map(e => e.relativePath);
	t.true(relPaths.includes('d1/f1.txt'));
	t.true(relPaths.includes('d1/d2/f2.txt'));
	t.true(relPaths.includes('d1/d2/d3/f3.txt'));
	t.false(relPaths.includes('d1/d2/d3/d4/f4.txt'));
});

test('walkDirectory hides dotfiles unless showHiddenFiles=true or listing hidden dir', async t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-walker-dot-'));
	t.teardown(() => {
		rmSync(dir, {recursive: true, force: true});
	});

	mkdirSync(join(dir, '.hidden'), {recursive: true});
	writeFileSync(join(dir, '.env'), 'SECRET=1');
	writeFileSync(join(dir, 'visible.txt'), 'ok');
	writeFileSync(join(dir, '.hidden', 'inner.txt'), 'inner');

	// Default: hides dotfiles
	const resultDefault = await walkDirectory({
		root: dir,
		dirPath: dir,
		recursive: true,
	});
	const defaultPaths = resultDefault.entries.map(e => e.relativePath);
	t.true(defaultPaths.includes('visible.txt'));
	t.false(defaultPaths.includes('.env'));
	t.false(defaultPaths.includes('.hidden'));

	// showHiddenFiles: true shows dotfiles
	const resultHidden = await walkDirectory({
		root: dir,
		dirPath: dir,
		recursive: true,
		showHiddenFiles: true,
	});
	const hiddenPaths = resultHidden.entries.map(e => e.relativePath);
	t.true(hiddenPaths.includes('.env'));
	t.true(hiddenPaths.includes('.hidden'));

	// Explicitly listing the hidden dir shows its contents
	const resultExplicit = await walkDirectory({
		root: dir,
		dirPath: join(dir, '.hidden'),
		recursive: true,
	});
	const explicitPaths = resultExplicit.entries.map(e => e.relativePath);
	t.true(explicitPaths.includes('inner.txt'));
});

test('walkDirectory respects .gitignore and .nanocoderignore', async t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-walker-ignore-'));
	t.teardown(() => {
		rmSync(dir, {recursive: true, force: true});
	});

	mkdirSync(join(dir, 'ignored-dir'), {recursive: true});
	mkdirSync(join(dir, 'keep'), {recursive: true});
	writeFileSync(join(dir, '.gitignore'), 'ignored-dir/\n*.secret\n');
	writeFileSync(join(dir, '.nanocoderignore'), 'nanocodered.txt\n');
	writeFileSync(join(dir, 'keep', 'file.txt'), 'keep');
	writeFileSync(join(dir, 'secret.secret'), 'secret');
	writeFileSync(join(dir, 'nanocodered.txt'), 'nano');
	writeFileSync(join(dir, 'ignored-dir', 'file.txt'), 'ignored');

	const result = await walkDirectory({
		root: dir,
		dirPath: dir,
		recursive: true,
	});

	const relPaths = result.entries.map(e => e.relativePath);
	t.true(relPaths.includes('keep/file.txt'));
	t.false(relPaths.includes('secret.secret'));
	t.false(relPaths.includes('nanocodered.txt'));
	t.false(relPaths.includes('ignored-dir'));
});

test('walkDirectory identifies symlinks and does not follow them', async t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-walker-symlink-'));
	t.teardown(() => {
		rmSync(dir, {recursive: true, force: true});
	});

	mkdirSync(join(dir, 'real'), {recursive: true});
	writeFileSync(join(dir, 'real', 'target.txt'), 'hello');
	symlinkSync(join(dir, 'real'), join(dir, 'link-to-real'));

	const result = await walkDirectory({
		root: dir,
		dirPath: dir,
		recursive: true,
	});

	const symlinkEntry = result.entries.find(e => e.name === 'link-to-real');
	t.truthy(symlinkEntry);
	t.is(symlinkEntry?.type, 'symlink');
	// Symlink was not recursed into
	t.false(result.entries.some(e => e.relativePath === 'link-to-real/target.txt'));
});

test('walkDirectory includes file sizes when showSizes=true', async t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-walker-sizes-'));
	t.teardown(() => {
		rmSync(dir, {recursive: true, force: true});
	});

	writeFileSync(join(dir, 'file.txt'), '12345');

	const result = await walkDirectory({
		root: dir,
		dirPath: dir,
		showSizes: true,
	});

	const fileEntry = result.entries.find(e => e.name === 'file.txt');
	t.truthy(fileEntry);
	t.is(fileEntry?.size, 5);
});
