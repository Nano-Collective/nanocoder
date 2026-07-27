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

test.before(() => {
	if (isWin) {
		writeFileSync(successScript, '@echo off\nexit /b 0');
		writeFileSync(failScript, '@echo off\nexit /b 1');
		writeFileSync(outputScript, '@echo off\necho hello world\nexit /b 0');
	} else {
		writeFileSync(successScript, '#!/bin/sh\nexit 0');
		writeFileSync(failScript, '#!/bin/sh\nexit 1');
		writeFileSync(outputScript, '#!/bin/sh\necho "hello world"\nexit 0');
	}
	chmodSync(successScript, 0o755);
	chmodSync(failScript, 0o755);
	chmodSync(outputScript, 0o755);
});

test.after.always(() => {
	if (existsSync(successScript)) unlinkSync(successScript);
	if (existsSync(failScript)) unlinkSync(failScript);
	if (existsSync(outputScript)) unlinkSync(outputScript);
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

test.serial('transcribeAudio - returns stdout', async (t) => {
	process.env.WHISPER_CMD = outputScript;
	const result = await transcribeAudio('test.wav');
	t.is(result, 'hello world');
});

test.serial('transcribeAudio - rejects on error', async (t) => {
	process.env.WHISPER_CMD = failScript;
	await t.throwsAsync(() => transcribeAudio('test.wav'), { message: /exit code 1/ });
});

test.serial('synthesizeSpeech - resolves on success', async (t) => {
	await t.notThrowsAsync(() => synthesizeSpeech('hello', 'test.wav'));
});

test.serial('synthesizeSpeech - rejects on error', async (t) => {
	process.env.PIPER_CMD = failScript;
	await t.throwsAsync(() => synthesizeSpeech('hello', 'test.wav'), { message: /exit code 1/ });
});

test.serial('playPhrase - orchestrates TTS and playback', async (t) => {
	await t.notThrowsAsync(() => playPhrase('hello'));
});
