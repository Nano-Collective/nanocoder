import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../test-utils/render-with-theme';
import {VoiceStatusBar} from './voice-status-bar';

const defaultProps = {
	theme: 'tokyo-night' as const,
};

test('VoiceStatusBar renders idle state correctly', t => {
	const {lastFrame} = renderWithTheme(
		<VoiceStatusBar {...defaultProps} state="idle" />
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Idle/);
});

test('VoiceStatusBar renders listening state correctly', t => {
	const {lastFrame} = renderWithTheme(
		<VoiceStatusBar {...defaultProps} state="listening" />
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Listening/);
});

test('VoiceStatusBar renders processing state correctly', t => {
	const {lastFrame} = renderWithTheme(
		<VoiceStatusBar {...defaultProps} state="processing" />
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Processing/);
});

test('VoiceStatusBar renders speaking state correctly', t => {
	const {lastFrame} = renderWithTheme(
		<VoiceStatusBar {...defaultProps} state="speaking" />
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Speaking/);
});

test('VoiceStatusBar works in narrow terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const {lastFrame} = renderWithTheme(
		<VoiceStatusBar {...defaultProps} state="idle" />
	);
	
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Voice:/);

	process.stdout.columns = originalColumns;
});
