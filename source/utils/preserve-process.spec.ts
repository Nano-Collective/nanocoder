import test from 'ava';
import {withPreservedProcess} from './preserve-process';

test.serial('withPreservedProcess restores globalThis.process when the conversion nulls it', async t => {
	const saved = globalThis.process;
	t.plan(3);

	const result = await withPreservedProcess(async () => {
		// What happy-dom's VMGlobalPropertyScript does to the real global on
		// pages with an <iframe> (see #1553): overwrites it after get-md's own
		// restore has already run.
		(globalThis as any).process = null;
		t.is(globalThis.process, null);
		return 'markdown';
	});

	t.is(result, 'markdown');
	t.is(globalThis.process, saved);
});

test.serial('withPreservedProcess keeps globalThis.process when the conversion leaves it alone', async t => {
	const saved = globalThis.process;

	const result = await withPreservedProcess(async () => 'markdown');

	t.is(result, 'markdown');
	t.is(globalThis.process, saved);
});

test.serial('withPreservedProcess restores globalThis.process even when the conversion throws', async t => {
	const saved = globalThis.process;

	await t.throwsAsync(
		withPreservedProcess(async () => {
			(globalThis as any).process = null;
			throw new Error('conversion failed');
		}),
		{message: 'conversion failed'},
	);

	t.is(globalThis.process, saved);
});
