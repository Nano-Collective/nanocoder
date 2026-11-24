import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	clearConfigFileCache,
	readCachedConfigFile,
} from '@/config/cached-reader';
import {setMessageQueueSink} from '@/utils/message-queue-core';

test.serial('readCachedConfigFile caches valid parses and strips BOM', t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-cache-reader-'));
	const file = join(dir, 'test.json');

	try {
		writeFileSync(file, '\uFEFF{"foo": "bar"}', 'utf-8');
		clearConfigFileCache();

		const first = readCachedConfigFile(file) as {foo: string};
		t.deepEqual(first, {foo: 'bar'});

		// Modify file content on disk without updating mtime or change it
		const second = readCachedConfigFile(file) as {foo: string};
		t.deepEqual(second, {foo: 'bar'});
		t.not(first, second); // returned structured clone
	} finally {
		clearConfigFileCache();
		rmSync(dir, {recursive: true, force: true});
	}
});

test.serial(
	'readCachedConfigFile caches failed parses and notifies error only once',
	t => {
		const dir = mkdtempSync(join(tmpdir(), 'nanocoder-cache-fail-'));
		const file = join(dir, 'bad.json');

		const captured: Array<{type: string; message: string}> = [];
		setMessageQueueSink((type, message) => {
			captured.push({type, message});
		});

		try {
			writeFileSync(file, '{"invalid": JSON,}', 'utf-8');
			clearConfigFileCache();

			const first = readCachedConfigFile(file);
			t.is(first, null);
			t.is(captured.length, 1);
			t.true(captured[0]!.message.includes('project config skipped'));
			t.true(captured[0]!.message.includes(file));

			// Second call should return null immediately without emitting a second error
			const second = readCachedConfigFile(file);
			t.is(second, null);
			t.is(captured.length, 1);
		} finally {
			setMessageQueueSink(null);
			clearConfigFileCache();
			rmSync(dir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'readCachedConfigFile defers error reporting until message sink is attached',
	t => {
		const dir = mkdtempSync(join(tmpdir(), 'nanocoder-cache-defer-'));
		const file = join(dir, 'bad.json');

		const captured: Array<{type: string; message: string}> = [];

		try {
			writeFileSync(file, '{"invalid": JSON,}', 'utf-8');
			clearConfigFileCache();
			setMessageQueueSink(null);

			// 1. First read happens before any sink is set (e.g. resolveActiveProfile at CLI startup)
			const first = readCachedConfigFile(file);
			t.is(first, null);
			t.is(captured.length, 0, 'No sink attached yet, captured should be empty');

			// 2. Install sink (e.g. plain shell or TUI mounts)
			setMessageQueueSink((type, message) => {
				captured.push({type, message});
			});

			// 3. Second read happens with sink attached (e.g. initializePlain or App loading config)
			const second = readCachedConfigFile(file);
			t.is(second, null);
			t.is(captured.length, 1, 'Error should be reported once sink is attached');
			t.true(captured[0]!.message.includes('project config skipped'));
			t.true(captured[0]!.message.includes(file));

			// 4. Subsequent reads must not re-emit the error
			const third = readCachedConfigFile(file);
			t.is(third, null);
			t.is(captured.length, 1, 'Subsequent read should not emit duplicate error');
		} finally {
			setMessageQueueSink(null);
			clearConfigFileCache();
			rmSync(dir, {recursive: true, force: true});
		}
	},
);

test.serial('readCachedConfigFile identifies global config files', t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-cache-global-'));
	const globalDir = join(dir, 'global-dir');
	const otherDir = join(dir, 'global-dir-other');
	mkdirSync(globalDir, {recursive: true});
	mkdirSync(otherDir, {recursive: true});

	const globalFile = join(globalDir, 'agents.config.json');
	const otherFile = join(otherDir, 'agents.config.json');

	const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
	const captured: Array<{type: string; message: string}> = [];
	setMessageQueueSink((type, message) => {
		captured.push({type, message});
	});

	try {
		process.env.NANOCODER_CONFIG_DIR = globalDir;
		writeFileSync(globalFile, '{broken}', 'utf-8');
		writeFileSync(otherFile, '{broken}', 'utf-8');
		clearConfigFileCache();

		readCachedConfigFile(globalFile);
		t.is(captured.length, 1);
		t.true(captured[0]!.message.includes('global config skipped'));

		readCachedConfigFile(otherFile);
		t.is(captured.length, 2);
		t.true(captured[1]!.message.includes('project config skipped'));
	} finally {
		setMessageQueueSink(null);
		if (originalConfigDir !== undefined) {
			process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
		} else {
			delete process.env.NANOCODER_CONFIG_DIR;
		}
		clearConfigFileCache();
		rmSync(dir, {recursive: true, force: true});
	}
});
