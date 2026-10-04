import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {useInput} from 'ink';

const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Ink 8 regression witness: when a component with `useInput` unmounts in the
 * same React commit that mounts another (the wizard's step transitions), keys
 * written during a short window right after the swap are dropped entirely.
 * Writes that arrive >=100ms later flow normally, so this test pins both
 * sides of the boundary: an early write must be absent and a late one
 * present. If the drop ever turned into "lose all input forever" (or the
 * window grew unboundedly), the late-write assertion fails.
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
	// Inside the post-swap dead window (~100ms): must be dropped.
	await wait(40);
	stdin.write('e');
	// Past the window: must be delivered.
	await wait(300);
	stdin.write('l');
	await wait(200);
	unmount();
	t.deepEqual(
		seen,
		['l'],
		'early key must be swallowed by the dead window, late key must flow',
	);
});

