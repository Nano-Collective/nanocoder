import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../test-utils/render-with-theme';
import ArchitectReviewPrompt from './architect-review-prompt';

const tick = () => new Promise(resolve => setTimeout(resolve, 30));

test('Keep leaves changes in place', async t => {
        const calls = {
                keep: 0,
                revert: 0,
                revise: 0,
        };

        const {stdin, unmount} = renderWithTheme(
                <ArchitectReviewPrompt
                        onKeep={() => {
                                calls.keep++;
                        }}
                        onRevert={() => {
                                calls.revert++;
                        }}
                        onRevertAndRevise={() => {
                                calls.revise++;
                        }}
                        onDismiss={() => {}}
                        filesChanged={['test.txt']}
                        filesMissing={[]}
                />,
        );

        await tick();
        stdin.write('\r');
        await tick();

        t.is(calls.keep, 1);
        t.is(calls.revert, 0);
        t.is(calls.revise, 0);

        unmount();
});
