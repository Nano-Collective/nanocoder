import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'ava';
import {getPackageVersion, UNKNOWN_VERSION} from './package-version.js';

console.log('\npackage-version.spec.ts');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let tmpDir: string;

test.before(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-pkg-version-'));
});

test.after.always(() => {
	fs.rmSync(tmpDir, {recursive: true, force: true});
});

/** Writes `contents` to a uniquely named file and returns its path. */
function fixture(name: string, contents: string): string {
	const filePath = path.join(tmpDir, name);
	fs.writeFileSync(filePath, contents, 'utf8');
	return filePath;
}

test('reads the version from a package.json', t => {
	const filePath = fixture('valid.json', JSON.stringify({version: '1.2.3'}));

	t.is(getPackageVersion(filePath), '1.2.3');
});

test('defaults to this package.json and returns its real version', t => {
	const {version} = JSON.parse(
		fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'),
	) as {version: string};

	// Asserted against an independent read so a regression to the fallback
	// cannot make this pass.
	t.is(getPackageVersion(), version);
	t.not(version, UNKNOWN_VERSION);
	t.regex(version, /^\d+\.\d+\.\d+/);
});

test('falls back when package.json is missing', t => {
	t.is(
		getPackageVersion(path.join(tmpDir, 'does-not-exist.json')),
		UNKNOWN_VERSION,
	);
});

test('falls back when package.json is not readable as JSON', t => {
	const filePath = fixture('invalid.json', '{"version": "1.2.3"');

	t.is(getPackageVersion(filePath), UNKNOWN_VERSION);
});

test('falls back when the path is a directory', t => {
	t.is(getPackageVersion(tmpDir), UNKNOWN_VERSION);
});

test('falls back when version is absent', t => {
	const filePath = fixture('no-version.json', JSON.stringify({name: 'x'}));

	t.is(getPackageVersion(filePath), UNKNOWN_VERSION);
});

test('falls back when version is not a string', t => {
	const filePath = fixture('numeric-version.json', JSON.stringify({version: 1}));

	t.is(getPackageVersion(filePath), UNKNOWN_VERSION);
});

test('falls back when version is an empty string', t => {
	const filePath = fixture('empty-version.json', JSON.stringify({version: ''}));

	t.is(getPackageVersion(filePath), UNKNOWN_VERSION);
});

// ---------------------------------------------------------------------------
// Candidate-layout resolution tests
//
// These exercise resolvePackageJsonPath() — the find(p => existsSync(p))
// candidate logic — so that a regression in the path candidates (misordering,
// wrong relative depth, swapping them) is caught by the test suite rather
// than silently making the CLI print "unknown" as its version.
// ---------------------------------------------------------------------------

import {resolvePackageJsonPath} from './package-version.js';

/**
 * Build a minimal dist tree inside `base` that mirrors one of the two build
 * output layouts and return the path to the package.json that should be
 * discovered for that layout.
 *
 * rolldown layout: everything compiles into a flat `dist/`
 *   → module dir is `dist/`, package.json is one level up at `base/package.json`
 *
 * tsc layout: module lands in `dist/utils/`
 *   → module dir is `dist/utils/`, package.json is two levels up at `base/package.json`
 */
function makeLayout(
	base: string,
	layout: 'rolldown' | 'tsc',
	version: string,
): {moduleDir: string; packageJsonPath: string} {
	const moduleDir =
		layout === 'rolldown'
			? path.join(base, 'dist')
			: path.join(base, 'dist', 'utils');
	const packageJsonPath = path.join(base, 'package.json');
	fs.mkdirSync(moduleDir, {recursive: true});
	fs.writeFileSync(packageJsonPath, JSON.stringify({version}), 'utf8');
	return {moduleDir, packageJsonPath};
}

test('resolvePackageJsonPath: picks ../package.json for rolldown flat layout', t => {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-rolldown-'));
	try {
		const {moduleDir, packageJsonPath} = makeLayout(base, 'rolldown', '9.8.7');
		// resolvePackageJsonPath(dist/) should find dist/../package.json = base/package.json
		t.is(resolvePackageJsonPath(moduleDir), packageJsonPath);
	} finally {
		fs.rmSync(base, {recursive: true, force: true});
	}
});

test('resolvePackageJsonPath: picks ../../package.json for tsc nested layout', t => {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-tsc-'));
	try {
		const {moduleDir, packageJsonPath} = makeLayout(base, 'tsc', '3.2.1');
		// resolvePackageJsonPath(dist/utils/) should skip dist/utils/../package.json
		// (does not exist) and find dist/utils/../../package.json = base/package.json
		t.is(resolvePackageJsonPath(moduleDir), packageJsonPath);
	} finally {
		fs.rmSync(base, {recursive: true, force: true});
	}
});

test('resolvePackageJsonPath: rolldown candidate wins when both package.json files exist', t => {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-both-'));
	try {
		// Rolldown layout: base/dist/ + base/package.json (version 2.0.0)
		// Also add a tsc-style package.json one level deeper at base/dist/package.json (version 1.0.0)
		const {moduleDir, packageJsonPath: rolldownPkg} = makeLayout(base, 'rolldown', '2.0.0');
		const tscPkg = path.join(base, 'dist', 'package.json');
		fs.writeFileSync(tscPkg, JSON.stringify({version: '1.0.0'}), 'utf8');

		// find() checks ../package.json first; it exists (rolldownPkg), so it wins
		t.is(resolvePackageJsonPath(moduleDir), rolldownPkg);
		t.not(resolvePackageJsonPath(moduleDir), tscPkg);
	} finally {
		fs.rmSync(base, {recursive: true, force: true});
	}
});

test('resolvePackageJsonPath: falls back to first candidate when neither exists', t => {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-empty-'));
	try {
		const moduleDir = path.join(base, 'dist');
		fs.mkdirSync(moduleDir, {recursive: true});
		// Neither ../package.json nor ../../package.json exist
		const result = resolvePackageJsonPath(moduleDir);
		// Should return the first candidate path (not throw)
		t.is(result, path.join(moduleDir, '../package.json'));
	} finally {
		fs.rmSync(base, {recursive: true, force: true});
	}
});
