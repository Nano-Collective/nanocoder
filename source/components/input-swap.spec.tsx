import test from 'ava';
import {Text, useInput} from 'ink';
import {render} from 'ink-testing-library';
import React from 'react';

const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));

// A same-commit unmount/mount of useInput must not leave the new step unable
// to receive input. Wait for the rendered step instead of requiring Ink's
// timing-dependent key-loss window to occur.
function Host({seen}: {seen: string[]}) {
	const [step, setStep] = React.useState<'a' | 'b'>('a');
	return step === 'a' ? (
		<ChildA onNext={() => setStep('b')} />
	) : (
		<ChildB seen={seen} />
	);
}

function ChildA({onNext}: {onNext: () => void}) {
	useInput((input, key) => {
		if (key.return) onNext();
	});
	return <Text>Step A</Text>;
}

function ChildB({seen}: {seen: string[]}) {
	useInput(input => {
		seen.push(input);
	});
	return <Text>Step B</Text>;
}

test.serial('same-commit useInput swap keeps input flowing', async t => {
	const seen: string[] = [];
	const {stdin, lastFrame, unmount} = render(<Host seen={seen} />);
	t.teardown(unmount);
	await wait();
	t.is(lastFrame(), 'Step A');
	stdin.write('\r');
	for (let attempt = 0; attempt < 50 && lastFrame() !== 'Step B'; attempt++) {
		await wait(20);
	}
	t.is(lastFrame(), 'Step B', 'the input must transition to the new step');
	await wait(150);
	stdin.write('q');
	await wait();
	stdin.write('l');
	await wait();
	t.deepEqual(seen, ['q', 'l'], 'input must keep flowing after the step swap');
});
