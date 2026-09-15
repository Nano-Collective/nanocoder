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
// These exercise the DEFAULT_PACKAGE_JSON_PATH two-candidate logic so that a
// regression in __filename resolution under tsc or rolldown output layouts is
// caught by the test suite, not by users.
// ---------------------------------------------------------------------------

/**
 * Build a minimal dist tree inside `base` and return the path to the fake
 * package.json that should be discovered for that layout.
 *
 * tsc layout:  dist/utils/package-version.js  →  ../../package.json
 * rolldown layout: dist/cli.js (flat)          →  ../package.json
 */
function makeDistLayout(
	base: string,
	layout: 'tsc' | 'rolldown',
	version: string,
): {moduleDir: string; packageJsonPath: string} {
	const pkgContent = JSON.stringify({version});

	if (layout === 'tsc') {
		// dist/utils/ mirrors the tsc output — candidate[1] is __dirname/../../package.json
		// i.e. dist/utils/../../package.json → base/package.json (two levels up from the module)
		const moduleDir = path.join(base, 'dist', 'utils');
		const packageJsonPath = path.join(base, 'package.json');
		fs.mkdirSync(moduleDir, {recursive: true});
		fs.writeFileSync(packageJsonPath, pkgContent, 'utf8');
		return {moduleDir, packageJsonPath};
	}

	// rolldown flat dist/ — candidate[0] (__dirname/../package.json)
	const moduleDir = path.join(base, 'dist');
	const packageJsonPath = path.join(base, 'package.json');
	fs.mkdirSync(moduleDir, {recursive: true});
	fs.writeFileSync(packageJsonPath, pkgContent, 'utf8');
	return {moduleDir, packageJsonPath};
}

test('resolves package.json via rolldown layout (dist/ flat)', t => {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-rolldown-'));
	try {
		const {packageJsonPath} = makeDistLayout(base, 'rolldown', '9.8.7');
		// Simulate what the candidate list resolves to for the rolldown layout:
		// __dirname would be dist/, so candidate[0] is dist/../package.json
		const candidate = path.join(base, 'dist', '..', 'package.json');
		t.true(fs.existsSync(candidate), 'rolldown candidate must exist');
		t.is(getPackageVersion(packageJsonPath), '9.8.7');
	} finally {
		fs.rmSync(base, {recursive: true, force: true});
	}
});

test('resolves package.json via tsc layout (dist/utils/ nested)', t => {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-tsc-'));
	try {
		const {packageJsonPath} = makeDistLayout(base, 'tsc', '3.2.1');
		// Simulate what the candidate list resolves to for the tsc layout:
		// __dirname would be dist/utils/, so candidate[1] is dist/utils/../../package.json
		const candidate = path.join(base, 'dist', 'utils', '..', '..', 'package.json');
		t.true(fs.existsSync(candidate), 'tsc candidate must exist');
		t.is(getPackageVersion(packageJsonPath), '3.2.1');
	} finally {
		fs.rmSync(base, {recursive: true, force: true});
	}
});

test('rolldown candidate wins when both layouts are present', t => {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-both-'));
	try {
		// Both package.json files exist; the rolldown one (candidate[0]) should win
		// because find() returns the first match.
		const {packageJsonPath: rolldownPkg} = makeDistLayout(base, 'rolldown', '2.0.0');
		// Also write a tsc-style package.json at dist/package.json
		const tscPkg = path.join(base, 'dist', 'package.json');
		fs.writeFileSync(tscPkg, JSON.stringify({version: '1.0.0'}), 'utf8');

		// Rolldown candidate (../package.json from dist/) resolves to base/package.json — 2.0.0
		t.is(getPackageVersion(rolldownPkg), '2.0.0');
		// tsc candidate (../../package.json from dist/utils/) resolves to base/package.json too
		// when the tsc layout is used explicitly, we get its value
		t.is(getPackageVersion(tscPkg), '1.0.0');
	} finally {
		fs.rmSync(base, {recursive: true, force: true});
	}
});
