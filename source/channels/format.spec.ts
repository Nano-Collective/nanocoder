import test from 'ava';
import {splitMessage} from './format';

console.log(`\nchannels/format.spec.ts`);

test('short text is returned as a single chunk', t => {
	t.deepEqual(splitMessage('hello', 100), ['hello']);
	t.deepEqual(splitMessage('', 100), ['']);
});

test('every chunk fits the limit and the text survives the round trip', t => {
	const words = Array.from({length: 200}, (_, i) => `word${i}`);
	const text = words.join(' ');
	const chunks = splitMessage(text, 64);

	t.true(chunks.length > 1);
	for (const chunk of chunks) t.true(chunk.length <= 64, chunk);
	t.deepEqual(chunks.join(' ').split(' '), words);
});

test('cuts land on a line break when one is in the back half of the window', t => {
	const text = `${'a'.repeat(30)}\n${'b'.repeat(30)}\n${'c'.repeat(30)}`;
	const chunks = splitMessage(text, 70);

	// The window holds both breaks; the later one wins so chunks stay full.
	t.deepEqual(chunks, [`${'a'.repeat(30)}\n${'b'.repeat(30)}`, 'c'.repeat(30)]);
});

test('text without any whitespace is hard-cut and never loses characters', t => {
	const text = 'x'.repeat(250);
	const chunks = splitMessage(text, 100);

	for (const chunk of chunks) t.true(chunk.length <= 100);
	t.is(chunks.join(''), text);
});

test('a code fence that spans a cut is closed and reopened', t => {
	const code = Array.from({length: 20}, (_, i) => `line ${i}`).join('\n');
	const text = `Here is the diff:\n\`\`\`\n${code}\n\`\`\`\nDone.`;
	const chunks = splitMessage(text, 80);

	t.true(chunks.length > 1);
	for (const chunk of chunks) {
		t.true(chunk.length <= 80, chunk);
		const fences = chunk.split('\n').filter(line => line.startsWith('```'));
		t.is(fences.length % 2, 0, `unbalanced fences in: ${chunk}`);
	}
	t.true(chunks[0]?.endsWith('```'));
	t.true(chunks[1]?.startsWith('```'));
});
