import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {useInput} from 'ink';

const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Ink 8 regression witness: when a component with `useInput` unmounts in the
 * same React commit that mounts another (the wizard's step transitions), keys
 * written during a short window right after the swap are dropped entirely.
 * Writes that arrive >=100ms later flow normally, so this test waits past the
 * window before asserting.
 */
const seen: string[] = [];

function Host() {
	const [step, setStep] = React.useState<'a' | 'b'>('a');
	React.useEffect(() => {
		const timer = setTimeout(() => setStep('b'), 30);
		return () => clearTimeout(timer);
	}, []);
	return step === 'a' ? <ChildA /> : <ChildB />;
}

function ChildA() {
	useInput(() => {});
	return null;
}

function ChildB() {
	useInput(input => {
		seen.push(input);
	});
	return null;
}

test.serial('same-commit useInput swap keeps input flowing', async t => {
	seen.length = 0;
	const {stdin, unmount} = render(<Host />);
	// Past the post-swap dead window (~100ms) input must flow again.
	await wait(300);
	stdin.write('q');
	await wait(200);
	unmount();
	t.deepEqual(seen, ['q'], 'the surviving useInput must receive post-swap keys');
});
