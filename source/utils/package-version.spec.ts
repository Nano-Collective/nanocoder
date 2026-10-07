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
