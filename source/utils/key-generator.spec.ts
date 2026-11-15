import test from 'ava';
import {
	generateKey,
	getKeyGeneratorSessionId,
	resetKeyGeneratorForTests,
	setKeyGeneratorSessionId,
} from './key-generator';

test.beforeEach(() => {
	resetKeyGeneratorForTests();
});

test('generateKey returns sessionId-prefix-counter format', t => {
	setKeyGeneratorSessionId('abc12345');
	t.is(generateKey('error'), 'abc12345-error-1');
	t.is(generateKey('error'), 'abc12345-error-2');
	t.is(generateKey('info'), 'abc12345-info-3');
});

test('generateKey produces unique keys for rapid successive calls', t => {
	setKeyGeneratorSessionId('test');
	const keys = new Set<string>();
	for (let i = 0; i < 10000; i++) {
		keys.add(generateKey('rapid'));
	}
	t.is(keys.size, 10000);
});

test('getKeyGeneratorSessionId returns lazily generated id', t => {
	const id = getKeyGeneratorSessionId();
	t.regex(id, /^[0-9a-f]{8}$/);
	t.is(getKeyGeneratorSessionId(), id);
});

test('setKeyGeneratorSessionId rebases prefix without resetting counter', t => {
	setKeyGeneratorSessionId('first');
	t.is(generateKey('x'), 'first-x-1');
	t.is(generateKey('x'), 'first-x-2');

	setKeyGeneratorSessionId('second');
	t.is(generateKey('x'), 'second-x-3');
});

test('resetKeyGeneratorForTests clears session id and counter', t => {
	setKeyGeneratorSessionId('before');
	generateKey('a');
	generateKey('a');

	resetKeyGeneratorForTests();

	const id = getKeyGeneratorSessionId();
	t.not(id, 'before');
	t.is(generateKey('a'), `${id}-a-1`);
});

test('generateKey works without explicit init', t => {
	const key = generateKey('untouched');
	t.regex(key, /^[0-9a-f]{8}-untouched-1$/);
});
