import test from 'ava';
import React from 'react';
import stripAnsi from 'strip-ansi';
import {renderWithTheme} from '../test-utils/render-with-theme.js';
import {ExternalContentNotice} from './external-content-notice';

test('ExternalContentNotice says the content is data, not instructions', t => {
	const {lastFrame} = renderWithTheme(<ExternalContentNotice />);
	const output = stripAnsi(lastFrame() ?? '');

	t.regex(output, /external content/);
	t.regex(output, /treated as data/);
	t.regex(output, /\u26a0/, 'the warning glyph marks it apart from tool output');
});
