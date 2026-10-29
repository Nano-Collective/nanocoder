import test from 'ava';
import {createPasteExtractor, emitPaste, registerPasteTarget} from './terminal-paste';

test.serial('pastes go to the innermost accepting target and fall back after unregister', t => {
	const seen: string[] = [];
	const outer = registerPasteTarget(payload => {
		seen.push(`outer:${payload}`);
		return true;
	});
	const inner = registerPasteTarget(payload => {
		seen.push(`inner:${payload}`);
		return true;
	});
	const disabled = registerPasteTarget(() => false);
	t.teardown(disabled);
	t.teardown(inner);
	t.teardown(outer);
	t.true(emitPaste('first'));
	t.deepEqual(seen, ['inner:first']);
	inner();
	t.true(emitPaste('second'));
	t.deepEqual(seen, ['inner:first', 'outer:second']);
	outer();
	t.false(emitPaste('unhandled'));
});

const START = '\x1b[200~';
const END = '\x1b[201~';
const key = (text: string) => ({kind: 'key', text});
const paste = (payload: string) => ({kind: 'paste', payload});

// Paste payloads must never reach the keypress parser: a pasted CR could submit.
test('passes ordinary typing through untouched', t => {
	t.deepEqual(createPasteExtractor()('hello'), [key('hello')]);
});

test('lifts a complete paste out of a single chunk', t => {
	t.deepEqual(createPasteExtractor()(`${START}pasted text${END}`), [
		paste('pasted text'),
	]);
});

test('keeps carriage returns inside the payload out of the key stream', t => {
	const payload = 'line one\rline two\r\nline three';
	t.deepEqual(createPasteExtractor()(`${START}${payload}${END}`), [paste(payload)]);
});

test('preserves text typed before and after a paste in stream order', t => {
	t.deepEqual(createPasteExtractor()(`before${START}middle${END}after`), [
		key('before'),
		paste('middle'),
		key('after'),
	]);
});

test('handles two pastes interleaved with keys in one chunk', t => {
	t.deepEqual(createPasteExtractor()(`a${START}one${END}b${START}two${END}c`), [
		key('a'),
		paste('one'),
		key('b'),
		paste('two'),
		key('c'),
	]);
});

test('handles adjacent pastes, including empty payloads', t => {
	t.deepEqual(createPasteExtractor()(`${START}${END}${START}two${END}`), [
		paste(''),
		paste('two'),
	]);
});

test('reassembles a payload split across chunks', t => {
	const extract = createPasteExtractor();
	t.deepEqual(extract(`before${START}first half `), [key('before')]);
	t.deepEqual(extract(`second half${END}after`), [
		paste('first half second half'),
		key('after'),
	]);
});

test('reassembles a start marker split across chunks', t => {
	const extract = createPasteExtractor();
	t.deepEqual(extract('\x1b[2'), []);
	t.deepEqual(extract(`00~payload${END}`), [paste('payload')]);
});

test('reassembles an end marker split across chunks', t => {
	const extract = createPasteExtractor();
	t.deepEqual(extract(`${START}payload`), []);
	t.deepEqual(extract('\x1b'), []);
	t.deepEqual(extract('[201~'), [paste('payload')]);
});

test('does not swallow a lone Escape keypress', t => {
	t.deepEqual(createPasteExtractor()('\x1b'), [key('\x1b')]);
});

test('does not swallow an arrow key', t => {
	t.deepEqual(createPasteExtractor()('\x1b[A'), [key('\x1b[A')]);
});

test('treats an escape sequence inside a payload as literal text', t => {
	const mouseLike = '\x1b[<64;10;5M';
	t.deepEqual(createPasteExtractor()(`${START}${mouseLike}${END}`), [paste(mouseLike)]);
});

test('a payload containing the start marker text does not nest', t => {
	t.deepEqual(createPasteExtractor()(`${START}a${START}b${END}`), [paste(`a${START}b`)]);
});

test('keeps state independent per extractor', t => {
	const a = createPasteExtractor();
	const b = createPasteExtractor();
	a(`${START}open`);
	t.deepEqual(b('typed'), [key('typed')]);
});
