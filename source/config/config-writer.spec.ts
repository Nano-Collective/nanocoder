import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'ava';
import {writeConfigFileAtomic} from './config-writer';

const posixOnly = process.platform === 'win32' ? test.serial.skip : test.serial;

test.serial('writeConfigFileAtomic writes JSON to the target', t => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-writer-'));
	try {
		const filePath = path.join(dir, 'agents.config.json');
		writeConfigFileAtomic(filePath, {nanocoder: {}});

		t.deepEqual(
			JSON.parse(fs.readFileSync(filePath, 'utf-8')),
			{nanocoder: {}},
		);
	} finally {
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

posixOnly(
	'writeConfigFileAtomic keeps an existing owner-only file owner-only',
	t => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-writer-'));
		try {
			const filePath = path.join(dir, 'agents.config.json');
			fs.writeFileSync(filePath, '{}', {mode: 0o600});

			writeConfigFileAtomic(filePath, {nanocoder: {}});

			t.is(fs.statSync(filePath).mode & 0o777, 0o600);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	},
);
