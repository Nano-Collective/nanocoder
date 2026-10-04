import test from 'ava';
import {render} from 'ink-testing-library';
import React, {useState} from 'react';
import {
	createXtermModifiedEnterRewriter,
	rewriteXtermModifiedEnter,
	splitControlKeypresses,
} from '@/utils/terminal-keypress';
import {
	createUtf8InputDecoder,
	stripMouseSequences,
} from '@/utils/terminal-mouse';
import {createPasteExtractor} from '@/utils/terminal-paste';
import TextInput from './text-input';

/**
 * Newline insertion, driven through stdin as real byte sequences.
 *
 * Shift+Enter has no single encoding — what reaches the process depends
 * entirely on the terminal, so each case below is named by the bytes and by
 * who sends them. The regressions these guard:
 *
 * - ESC+CR submitted the prompt instead of inserting a newline
 * - the xterm modifyOtherKeys form was unparseable by Ink and its ESC-stripped
 *   sequence was inserted into the prompt as the literal text `[27;2;13~`; Ink 8
 *   drops unrecognised control sequences outright, so cli.tsx now rewrites
 *   that form into kitty CSI-u before the bytes reach Ink — mirrored below
 * - the kitty CSI-u form appended '\n' to the end of the value rather than at
 *   the cursor, and left the cursor stranded in front of it, so the next
 *   character typed went on the wrong line
 *
 * Sequences used:
 *   LF (Ctrl+J)                  \n
 *   ESC+CR (Option/Alt+Enter)    ESC \r
 *   kitty CSI-u Shift+Enter      ESC [13;2u
 *   xterm modifyOtherKeys        ESC [27;2;13~  (rewritten to ESC [13;2u)
 *   bare CR (Enter)              \r
 *   Left                         ESC [D
 */

const ESC = '\u001b';
const LF = '\n';
const ESC_CR = `${ESC}\r`;
const KITTY_SHIFT_ENTER = `${ESC}[13;2u`;
// What xterm.js actually emits; the stdin proxy in cli.tsx rewrites this into
// KITTY_SHIFT_ENTER before Ink sees it, so mirror that composition here.
const XTERM_SHIFT_ENTER = rewriteXtermModifiedEnter(`${ESC}[27;2;13~`);
const LEFT = `${ESC}[D`;

interface ValueRef {
	current: string;
}

function ControlledTextInput({
	valueRef,
	initialValue = '',
}: {
	valueRef: ValueRef;
	initialValue?: string;
}) {
	const [value, setValue] = useState(initialValue);
	valueRef.current = value;
	return (
		<TextInput value={value} onChange={setValue} focus={true} showCursor={true} />
	);
}

const press = (stdin: ReturnType<typeof render>['stdin'], key: string) =>
	new Promise<void>(resolve => {
		stdin.write(key);
		setTimeout(resolve, 20);
	});

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 100));

// Match the CLI filtering order, but feed each filtered piece directly into
// ink-testing-library's readable stream instead of the CLI's PassThrough queue.
function createInputProxy(stdin: ReturnType<typeof render>['stdin']) {
	const decode = createUtf8InputDecoder();
	const extractPastes = createPasteExtractor();
	const pastes: string[] = [];
	const rewriter = createXtermModifiedEnterRewriter(text => {
		for (const piece of splitControlKeypresses(text)) stdin.write(piece);
	});
	let carry = '';
	return {
		push(chunk: Buffer | string) {
			const split = extractPastes(decode(chunk));
			pastes.push(...split.pastes);
			const result = stripMouseSequences(split.clean, carry);
			carry = result.carry;
			rewriter.push(result.clean);
		},
		pastes,
		dispose: () => rewriter.dispose(),
	};
}

const newlineSequences: Array<[string, string]> = [
	['LF (Ctrl+J)', LF],
	['ESC+CR (Option/Alt+Enter)', ESC_CR],
	['kitty CSI-u Shift+Enter', KITTY_SHIFT_ENTER],
	['xterm modifyOtherKeys Shift+Enter', XTERM_SHIFT_ENTER],
];

for (const [label, sequence] of newlineSequences) {
	test(`${label} inserts a newline at the end of the value`, async t => {
		const valueRef: ValueRef = {current: ''};
		const {stdin, unmount} = render(
			<ControlledTextInput valueRef={valueRef} initialValue="aaa" />,
		);

		await press(stdin, sequence);
		await settle();

		t.is(valueRef.current, 'aaa\n');
		unmount();
	});

	test(`${label} leaves the cursor after the newline`, async t => {
		const valueRef: ValueRef = {current: ''};
		const {stdin, unmount} = render(
			<ControlledTextInput valueRef={valueRef} initialValue="aaa" />,
		);

		// The cursor, not the value, is what the append-to-the-end bug got
		// wrong: the newline landed correctly but the caret stayed in front of
		// it, so the next character typed went back onto the first line.
		await press(stdin, sequence);
		await press(stdin, 'b');
		await settle();

		t.is(valueRef.current, 'aaa\nb');
		unmount();
	});

	test(`${label} inserts at the cursor, not the end of the value`, async t => {
		const valueRef: ValueRef = {current: ''};
		const {stdin, unmount} = render(
			<ControlledTextInput valueRef={valueRef} initialValue="aaabbb" />,
		);

		await press(stdin, LEFT);
		await press(stdin, LEFT);
		await press(stdin, LEFT);
		await press(stdin, sequence);
		await settle();

		t.is(valueRef.current, 'aaa\nbbb');
		unmount();
	});
}

for (const [label, modifier] of [
	['Shift', 2],
	['Alt', 3],
] as const) {
	test(`fragmented xterm ${label}+Enter survives the input proxy at every boundary`, async t => {
		const valueRef: ValueRef = {current: ''};
		const {stdin, unmount} = render(
			<ControlledTextInput valueRef={valueRef} initialValue="aaa" />,
		);
		const proxy = createInputProxy(stdin);
		t.teardown(() => {
			proxy.dispose();
			unmount();
		});
		await settle();
		const sequence = `${ESC}[27;${modifier};13~`;
		let expected = 'aaa';
		for (let boundary = 1; boundary < sequence.length; boundary++) {
			proxy.push(Buffer.from(sequence.slice(0, boundary)));
			await new Promise<void>(resolve => setImmediate(resolve));
			proxy.push(Buffer.from(sequence.slice(boundary)));
			await settle();
			expected += '\n';
			t.is(valueRef.current, expected, `boundary ${boundary}`);
			proxy.push('b');
			await settle();
			expected += 'b';
			t.is(valueRef.current, expected, `cursor after boundary ${boundary}`);
		}
	});
}

test('the input proxy leaves bracketed paste payloads opaque', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="aaa" />,
	);
	const proxy = createInputProxy(stdin);
	t.teardown(() => {
		proxy.dispose();
		unmount();
	});
	await settle();
	const payload = `pasted\n${ESC}[27;2;13~${ESC}[<64;1;1M`;
	proxy.push(`${ESC}[200~${payload.slice(0, 12)}`);
	proxy.push(`${payload.slice(12)}${ESC}[201~${ESC}[<64;1;1M`);
	proxy.push(`b${ESC}[27;3;`);
	proxy.push('13~');
	await settle();
	t.deepEqual(proxy.pastes, [payload]);
	t.is(valueRef.current, 'aaab\n');
});

test('consecutive newlines stack instead of overwriting each other', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="a" />,
	);

	await press(stdin, LF);
	await press(stdin, 'b');
	await press(stdin, KITTY_SHIFT_ENTER);
	await press(stdin, 'c');
	await settle();

	t.is(valueRef.current, 'a\nb\nc');
	unmount();
});

test('a bare carriage return does not insert a newline', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="aaa" />,
	);

	// Plain Enter is byte-identical to Shift+Enter in most terminals, so it
	// must stay on the submit path rather than becoming a newline.
	await press(stdin, '\r');
	await settle();

	t.is(valueRef.current, 'aaa');
	unmount();
});

test('the xterm modifyOtherKeys sequence never reaches the value as text', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="" />,
	);

	await press(stdin, XTERM_SHIFT_ENTER);
	await settle();

	t.false(valueRef.current.includes('27;2;13'));
	t.false(valueRef.current.includes('['));
	unmount();
});
