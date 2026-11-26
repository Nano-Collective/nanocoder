import test from 'ava';
import {prefillComposer, subscribeComposerPrefill} from './composer-draft';

console.log('\ncomposer-draft.spec.ts');

test('prefillComposer hands the text to every listener', t => {
	const received: string[] = [];
	const unsubscribes = [
		subscribeComposerPrefill(text => received.push(`a:${text}`)),
		subscribeComposerPrefill(text => received.push(`b:${text}`)),
	];

	prefillComposer('fix the parser');

	for (const unsubscribe of unsubscribes) unsubscribe();
	t.deepEqual(received, ['a:fix the parser', 'b:fix the parser']);
});

test('an unsubscribed listener is not called', t => {
	let calls = 0;
	const unsubscribe = subscribeComposerPrefill(() => {
		calls += 1;
	});

	unsubscribe();
	prefillComposer('hello');
	// Unsubscribing twice must not throw either: a component can unmount while
	// another listener is being notified.
	unsubscribe();

	t.is(calls, 0);
});
