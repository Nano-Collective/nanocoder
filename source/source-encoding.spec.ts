import test from 'ava';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Biome refuses to process files that are not valid UTF-8, which breaks
// `test:lint` and `test:format` for the whole repo (see #1862).
const sourceDir = fileURLToPath(new URL('.', import.meta.url));

test('every source file is valid UTF-8', t => {
	const decoder = new TextDecoder('utf-8', {fatal: true});
	const files = readdirSync(sourceDir, {recursive: true, encoding: 'utf8'})
		.filter(file => /\.(ts|tsx|js|json|md)$/.test(file))
		.filter(file => !file.split(/[\\/]/).includes('node_modules'));

	const invalid = files.filter(file => {
		try {
			decoder.decode(readFileSync(join(sourceDir, file)));
			return false;
		} catch {
			return true;
		}
	});

	t.true(files.length > 0);
	t.deepEqual(invalid, []);
});
