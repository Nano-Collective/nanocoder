import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../test-utils/render-with-theme';
import {
	ArtifactLinksDisplay,
	createTerminalArtifactLink,
} from './artifact-links-display';

test('ArtifactLinksDisplay renders clickable lifecycle artifact labels', t => {
	const artifacts = [
		{kind: 'implementation_plan' as const, path: '/tmp/implementation_plan.md'},
		{kind: 'task' as const, path: '/tmp/task.md'},
		{kind: 'walkthrough' as const, path: '/tmp/walkthrough.md'},
	];
	const {lastFrame, unmount} = renderWithTheme(
		<ArtifactLinksDisplay artifacts={artifacts} />,
	);

	const frame = lastFrame() ?? '';
	t.true(frame.includes('Artifacts'));
	t.true(frame.includes('Plan'));
	t.true(frame.includes('Tasks'));
	t.true(frame.includes('Walkthrough'));
	t.true(
		createTerminalArtifactLink(artifacts[1], 'Tasks').includes('file:///tmp/task.md'),
	);
	unmount();
});
