import test from 'ava';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, unlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { platform } from 'node:process';
import { randomUUID } from 'node:crypto';

import {
	recordAudio,
	playAudio,
	transcribeAudio,
	synthesizeSpeech,
	playPhrase,
} from './index.ts';

const isWin = platform === 'win32';
const ext = isWin ? '.bat' : '.sh';
const successScript = join(tmpdir(), `mock-success-${randomUUID()}${ext}`);
const failScript = join(tmpdir(), `mock-fail-${randomUUID()}${ext}`);
const outputScript = join(tmpdir(), `mock-output-${randomUUID()}${ext}`);
const hangScript = join(tmpdir(), `mock-hang-${randomUUID()}${ext}`);

test.before(() => {
	if (isWin) {
		writeFileSync(successScript, '@echo off\nexit /b 0');
		writeFileSync(failScript, '@echo off\nexit /b 1');
		writeFileSync(outputScript, '@echo off\necho hello world\nexit /b 0');
		writeFileSync(hangScript, '@echo off\nping 127.0.0.1 -n 10 > nul\nexit /b 0');
	} else {
		writeFileSync(successScript, '#!/bin/sh\nexit 0');
		writeFileSync(failScript, '#!/bin/sh\nexit 1');
		writeFileSync(outputScript, '#!/bin/sh\necho "hello world"\nexit 0');
		writeFileSync(hangScript, '#!/bin/sh\nsleep 10\nexit 0');
	}
	chmodSync(successScript, 0o755);
	chmodSync(failScript, 0o755);
	chmodSync(outputScript, 0o755);
	chmodSync(hangScript, 0o755);
});

test.after.always(() => {
	if (existsSync(successScript)) unlinkSync(successScript);
	if (existsSync(failScript)) unlinkSync(failScript);
	if (existsSync(outputScript)) unlinkSync(outputScript);
	if (existsSync(hangScript)) unlinkSync(hangScript);
});

test.beforeEach(() => {
	process.env.REC_CMD = successScript;
	process.env.PLAY_CMD = successScript;
	process.env.WHISPER_CMD = successScript;
	process.env.PIPER_CMD = successScript;
});

test.serial('recordAudio - resolves on success', async (t) => {
	await t.notThrowsAsync(() => recordAudio('test.wav'));
});

test.serial('recordAudio - resolves on success (with duration)', async (t) => {
	await t.notThrowsAsync(() => recordAudio('test.wav', 1000));
});

test.serial('recordAudio - resolves on success (Windows path with duration)', async (t) => {
	const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
	Object.defineProperty(process, 'platform', { value: 'win32' });
	
	const originalPath = process.env.PATH;
	process.env.PATH = tmpdir() + (isWin ? ';' : ':') + process.env.PATH;
	
	const soxScript = join(tmpdir(), isWin ? 'sox.bat' : 'sox');
	if (isWin) {
		writeFileSync(soxScript, '@echo off\nexit /b 0');
	} else {
		writeFileSync(soxScript, '#!/bin/sh\nexit 0');
	}
	chmodSync(soxScript, 0o755);

	// Clear REC_CMD so it falls back to 'sox' command via Windows logic
	delete process.env.REC_CMD;

	await t.notThrowsAsync(() => recordAudio('test.wav', 1000));
	
	if (originalPlatform) {
		Object.defineProperty(process, 'platform', originalPlatform);
	}
	process.env.PATH = originalPath;
	unlinkSync(soxScript);
});

test.serial('recordAudio - aborts immediately if signal is already aborted', async (t) => {
	const controller = new AbortController();
	controller.abort();
	await t.throwsAsync(() => recordAudio('test.wav', 1000, controller.signal), { message: /AbortError/ });
});

test.serial('recordAudio - aborts mid-execution', async (t) => {
	process.env.REC_CMD = hangScript;
	const controller = new AbortController();
	setTimeout(() => controller.abort(), 100);
	await t.throwsAsync(() => recordAudio('test.wav', 0, controller.signal), { message: /AbortError/ });
});

test.serial('recordAudio - rejects on error', async (t) => {
	process.env.REC_CMD = failScript;
	await t.throwsAsync(() => recordAudio('test.wav'), { message: /exit code 1/ });
});

test.serial('playAudio - resolves on success', async (t) => {
	await t.notThrowsAsync(() => playAudio('test.wav'));
});

test.serial('playAudio - rejects on error', async (t) => {
	process.env.PLAY_CMD = failScript;
	await t.throwsAsync(() => playAudio('test.wav'), { message: /exit code 1/ });
});

test.serial('playAudio - times out', async (t) => {
	process.env.PLAY_CMD = hangScript;
	await t.throwsAsync(() => playAudio('test.wav', 100), { message: /timed out/ });
});

test.serial('playAudio - aborts mid-execution', async (t) => {
	process.env.PLAY_CMD = hangScript;
	const controller = new AbortController();
	setTimeout(() => controller.abort(), 100);
	await t.throwsAsync(() => playAudio('test.wav', 0, controller.signal), { message: /AbortError/ });
});

test.serial('transcribeAudio - returns stdout', async (t) => {
	process.env.WHISPER_CMD = outputScript;
	const result = await transcribeAudio('test.wav');
	t.is(result, 'hello world');
});

test.serial('transcribeAudio - rejects on error', async (t) => {
	process.env.WHISPER_CMD = failScript;
	await t.throwsAsync(() => transcribeAudio('test.wav'), { message: /exit code 1/ });
});

test.serial('transcribeAudio - aborts mid-execution', async (t) => {
	process.env.WHISPER_CMD = hangScript;
	const controller = new AbortController();
	setTimeout(() => controller.abort(), 100);
	await t.throwsAsync(() => transcribeAudio('test.wav', 5000, controller.signal), { message: /AbortError/ });
});

test.serial('synthesizeSpeech - resolves on success', async (t) => {
	await t.notThrowsAsync(() => synthesizeSpeech('hello', 'test.wav'));
});

test.serial('synthesizeSpeech - rejects on error', async (t) => {
	process.env.PIPER_CMD = failScript;
	await t.throwsAsync(() => synthesizeSpeech('hello', 'test.wav'), { message: /exit code 1/ });
});

test.serial('synthesizeSpeech - aborts mid-execution', async (t) => {
	process.env.PIPER_CMD = hangScript;
	const controller = new AbortController();
	setTimeout(() => controller.abort(), 100);
	await t.throwsAsync(() => synthesizeSpeech('hello', 'test.wav', 5000, controller.signal), { message: /AbortError/ });
});

test.serial('playPhrase - orchestrates TTS and playback', async (t) => {
	await t.notThrowsAsync(() => playPhrase('hello'));
});
