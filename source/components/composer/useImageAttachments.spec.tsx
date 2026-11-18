import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import type {ClipboardImageResult} from '../../input/clipboard-image';
import type {ImageAttachment} from '../../types/core';
import {
	collectDroppedImages,
	useImageAttachments,
} from './useImageAttachments.js';

type Attachments = ReturnType<typeof useImageAttachments>;

const pasted: ImageAttachment = {
	data: 'AAAA',
	mediaType: 'image/png',
	source: 'clipboard',
};

function tempImage(t: {teardown: (fn: () => void) => void}, name: string) {
	const dir = mkdtempSync(join(tmpdir(), 'attach-'));
	t.teardown(() => rmSync(dir, {recursive: true, force: true}));
	const path = join(dir, name);
	writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
	return path;
}

test('a dropped image path becomes an attachment numbered after the existing ones', t => {
	const path = tempImage(t, 'shot.png');
	const result = collectDroppedImages(
		[pasted],
		`what is in ${path} here`,
		`what is in ${path} here`,
	);

	t.is(result.images.length, 2);
	t.is(result.images[0], pasted);
	t.is(result.images[1]!.source, 'shot.png');
	t.is(result.images[1]!.mediaType, 'image/png');
	t.is(result.assembled, 'what is in [Image #2] here');
	t.is(result.display, 'what is in [Image #2] here');
});

test('text without readable image paths passes through untouched', t => {
	const result = collectDroppedImages(
		[pasted],
		'see /no/such/file.png and notes.txt',
		'see /no/such/file.png and notes.txt',
	);
	t.deepEqual(result.images, [pasted]);
	t.is(result.assembled, 'see /no/such/file.png and notes.txt');
	t.is(result.display, 'see /no/such/file.png and notes.txt');
});

test('the sent and displayed text are cleaned independently', t => {
	const path = tempImage(t, 'pic.jpg');
	// The sent text carries expanded placeholder content the display lacks.
	const result = collectDroppedImages(
		[],
		`look ${path}\n\n=== file contents ===`,
		`look ${path}`,
	);
	t.is(result.assembled, 'look [Image #1]\n\n=== file contents ===');
	t.is(result.display, 'look [Image #1]');
});

function setup(
	readClipboard: () => Promise<ClipboardImageResult> = async () => ({
		image: null,
	}),
) {
	let hook!: Attachments;
	function Probe() {
		hook = useImageAttachments(readClipboard);
		return null;
	}
	const view = render(<Probe />);
	return {
		get hook() {
			return hook;
		},
		async act(fn: (h: Attachments) => void) {
			fn(hook);
			await new Promise(resolve => setTimeout(resolve, 20));
		},
		unmount: view.unmount,
	};
}

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 20));

test('replace, removeLast and clear manage the pending list', async t => {
	const s = setup();
	t.teardown(s.unmount);
	const second = {...pasted, source: 'second'};

	t.deepEqual(s.hook.attachments, []);
	await s.act(h => h.replace([pasted, second]));
	t.deepEqual(s.hook.attachments, [pasted, second]);

	await s.act(h => h.removeLast());
	t.deepEqual(s.hook.attachments, [pasted]);

	await s.act(h => h.clear());
	t.deepEqual(s.hook.attachments, []);

	// Removing from an empty list is a no-op, not an error.
	await s.act(h => h.removeLast());
	t.deepEqual(s.hook.attachments, []);
});

test('the list operations keep their identity across renders', async t => {
	const s = setup();
	t.teardown(s.unmount);
	const first = s.hook;
	await s.act(h => h.replace([pasted]));
	t.is(s.hook.replace, first.replace);
	t.is(s.hook.clear, first.clear);
	t.is(s.hook.removeLast, first.removeLast);
	t.is(s.hook.attachFromClipboard, first.attachFromClipboard);
});

test('attachFromClipboard adds the image a background read returns', async t => {
	let resolveRead!: (result: ClipboardImageResult) => void;
	const s = setup(
		() =>
			new Promise<ClipboardImageResult>(resolve => {
				resolveRead = resolve;
			}),
	);
	t.teardown(s.unmount);

	const read = s.hook.attachFromClipboard();
	// The read is in flight: nothing is attached yet and the composer is free
	// to keep rendering.
	t.deepEqual(s.hook.attachments, []);

	resolveRead({image: pasted});
	await read;
	await settle();

	t.deepEqual(s.hook.attachments, [pasted]);
	t.is(s.hook.clipboardNotice, null);
});

test('attachFromClipboard surfaces why the clipboard read failed', async t => {
	const s = setup(async () => ({
		image: null,
		error: 'Clipboard image read timed out after 3s',
	}));
	t.teardown(s.unmount);

	await s.hook.attachFromClipboard();
	await settle();

	t.deepEqual(s.hook.attachments, []);
	t.is(s.hook.clipboardNotice, 'Clipboard image read timed out after 3s');
});

test('attachFromClipboard stays quiet when the clipboard holds no image', async t => {
	const s = setup(async () => ({image: null}));
	t.teardown(s.unmount);

	await s.hook.attachFromClipboard();
	await settle();

	t.deepEqual(s.hook.attachments, []);
	t.is(s.hook.clipboardNotice, null);
});

test('attachFromClipboard reports a thrown read instead of rejecting', async t => {
	const s = setup(async () => {
		throw new Error('boom');
	});
	t.teardown(s.unmount);

	await t.notThrowsAsync(s.hook.attachFromClipboard());
	await settle();

	t.deepEqual(s.hook.attachments, []);
	t.is(s.hook.clipboardNotice, 'Could not read the clipboard image');
});

test('a second Ctrl+V while a read runs does not start another read', async t => {
	let calls = 0;
	let release!: (result: ClipboardImageResult) => void;
	const s = setup(() => {
		calls += 1;
		return new Promise<ClipboardImageResult>(resolve => {
			release = resolve;
		});
	});
	t.teardown(s.unmount);

	const first = s.hook.attachFromClipboard();
	const second = s.hook.attachFromClipboard();
	t.is(calls, 1);

	release({image: pasted});
	await Promise.all([first, second]);
	await settle();

	t.deepEqual(s.hook.attachments, [pasted]);
});

test('clear drops attachments and the clipboard notice', async t => {
	const s = setup(async () => ({
		image: null,
		error: 'Clipboard image is larger than 10 MB',
	}));
	t.teardown(s.unmount);

	await s.hook.attachFromClipboard();
	await settle();
	t.is(s.hook.clipboardNotice, 'Clipboard image is larger than 10 MB');

	await s.act(h => h.clear());
	t.deepEqual(s.hook.attachments, []);
	t.is(s.hook.clipboardNotice, null);
});
