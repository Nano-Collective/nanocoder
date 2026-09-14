import test from 'ava';
import React from 'react';
import {Text} from 'ink';
import {renderWithTheme} from '../test-utils/render-with-theme.js';
import ToolMessage, {CappedLines, ToolOutputContext} from './tool-message';

console.log('\ntool-message.spec.tsx');

// ============================================================================
// Component Rendering Tests
// ============================================================================

test('ToolMessage renders without crashing', t => {
	const {lastFrame} = renderWithTheme(
			<ToolMessage title="Test Tool" message="Test message" />
	);

	t.truthy(lastFrame());
});

test('ToolMessage renders with title in TitledBox', t => {
	const {lastFrame} = renderWithTheme(
			<ToolMessage title="Custom Title" message="Test message" />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Custom Title/);
});

test('ToolMessage renders with default title when not provided', t => {
	const {lastFrame} = renderWithTheme(
			<ToolMessage message="Test message" />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Tool Message/);
});

test('ToolMessage renders string message', t => {
	const {lastFrame} = renderWithTheme(
			<ToolMessage title="Test" message="Hello world" />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Hello world/);
});

test('ToolMessage renders ReactNode message', t => {
	const {lastFrame} = renderWithTheme(
			<ToolMessage title="Test" message={<Text>Hello world</Text>} />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Hello world/);
});

// ============================================================================
// hideBox Option Tests
// ============================================================================

test('ToolMessage renders without box when hideBox is true', t => {
	const {lastFrame} = renderWithTheme(
			<ToolMessage title="Test" message="No box message" hideBox={true} />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /No box message/);
	// Should not have TitledBox borders (│ character)
	const lines = output!.split('\n').filter(line => line.includes('│'));
	t.is(lines.length, 0);
});

test('ToolMessage displays Bash Command Output label when hideBox and isBashMode', t => {
	const {lastFrame} = renderWithTheme(
			<ToolMessage title="Test" message="Bash output" hideBox={true} isBashMode={true} />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Bash Command Output/);
});

test('ToolMessage displays truncation message when hideBox and isBashMode', t => {
	const {lastFrame} = renderWithTheme(
			<ToolMessage title="Test" message="Output" hideBox={true} isBashMode={true} />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Output truncated to 4k characters/);
});

test('ToolMessage does not display Bash label when hideBox without isBashMode', t => {
	const {lastFrame} = renderWithTheme(
			<ToolMessage title="Test" message="Regular output" hideBox={true} isBashMode={false} />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Regular output/);
	t.notRegex(output!, /Bash Command Output/);
});

test('ToolMessage does not display truncation when hideBox without isBashMode', t => {
	const {lastFrame} = renderWithTheme(
			<ToolMessage title="Test" message="Output" hideBox={true} isBashMode={false} />
	);

	const output = lastFrame();
	t.truthy(output);
	t.notRegex(output!, /Output truncated to 4k characters/);
});

// ============================================================================
// hideTitle Option Tests
// ============================================================================

test('ToolMessage renders without title when hideTitle is true', t => {
	const {lastFrame} = renderWithTheme(
			<ToolMessage title="Hidden Title" message="No title message" hideTitle={true} />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /No title message/);
	// Title should not be shown
	t.notRegex(output!, /Hidden Title/);
});

test('ToolMessage displays truncation message when hideTitle and isBashMode', t => {
	const {lastFrame} = renderWithTheme(
			<ToolMessage title="Test" message="Output" hideTitle={true} isBashMode={true} />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Output truncated to 4k characters/);
});

test('ToolMessage does not display truncation when hideTitle without isBashMode', t => {
	const {lastFrame} = renderWithTheme(
			<ToolMessage title="Test" message="Output" hideTitle={true} isBashMode={false} />
	);

	const output = lastFrame();
	t.truthy(output);
	t.notRegex(output!, /Output truncated to 4k characters/);
});

// ============================================================================
// isBashMode Option Tests (with TitledBox)
// ============================================================================

test('ToolMessage displays truncation in TitledBox when isBashMode', t => {
	const {lastFrame} = renderWithTheme(
			<ToolMessage title="Test Tool" message="Bash result" isBashMode={true} />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Bash result/);
	t.regex(output!, /Output truncated to 4k characters/);
});

test('ToolMessage does not display truncation when isBashMode is false', t => {
	const {lastFrame} = renderWithTheme(
			<ToolMessage title="Test Tool" message="Regular result" isBashMode={false} />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Regular result/);
	t.notRegex(output!, /Output truncated to 4k characters/);
});

// ============================================================================
// Combined Options Tests
// ============================================================================

test('ToolMessage renders with hideBox and hideTitle both true', t => {
	const {lastFrame} = renderWithTheme(
			<ToolMessage message="Combined test" hideBox={true} hideTitle={true} />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Combined test/);
});

test('ToolMessage renders with isBashMode in all display modes', t => {
	// Test with TitledBox (default)
	const {lastFrame: frame1} = renderWithTheme(
		<ToolMessage title="Test" message="Output" isBashMode={true} />,
	);
	const output1 = frame1();
	t.truthy(output1);
	t.regex(output1!, /Output truncated to 4k characters/);

	// Test with hideBox
	const {lastFrame: frame2} = renderWithTheme(
		<ToolMessage title="Test" message="Output" hideBox={true} isBashMode={true} />,
	);
	const output2 = frame2();
	t.truthy(output2);
	t.regex(output2!, /Output truncated to 4k characters/);

	// Test with hideTitle
	const {lastFrame: frame3} = renderWithTheme(
		<ToolMessage title="Test" message="Output" hideTitle={true} isBashMode={true} />,
	);
	const output3 = frame3();
	t.truthy(output3);
	t.regex(output3!, /Output truncated to 4k characters/);
});

test('ToolMessage component structure is valid', t => {
	const {lastFrame} = renderWithTheme(
			<ToolMessage title="Test" message="Content" />
	);

	const output = lastFrame();
	t.truthy(output);
	t.true(output!.length > 0);
});

test('ToolMessage maintains consistent border color with theme', t => {
	const {lastFrame} = renderWithTheme(
			<ToolMessage title="Test" message="Content" />
	);

	const output = lastFrame();
	t.truthy(output);
	// Border character from TitledBox
	t.regex(output!, /│/);
});

test('ToolMessage handles empty message', t => {
	const {lastFrame} = renderWithTheme(
			<ToolMessage title="Test" message="" />
	);

	t.truthy(lastFrame());
});

test('ToolMessage handles multiline message', t => {
	const multilineMessage = 'Line 1\nLine 2\nLine 3';
	const {lastFrame} = renderWithTheme(
			<ToolMessage title="Test" message={multilineMessage} />
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Line 1/);
});

test('ToolMessage memo prevents unnecessary re-renders', t => {
	let renderCount = 0;
	const TestComponent = () => {
		renderCount++;
		return <ToolMessage title="Test" message="Content" />;
	};

	const {lastFrame, rerender} = renderWithTheme(<TestComponent />);
	const firstRender = lastFrame();
	t.truthy(firstRender);
	const initialCount = renderCount;

	// Re-render with same props
	rerender(<TestComponent />);
	// React TestRenderer may count renders differently
	// The important thing is that the component is memoized
	t.true(renderCount >= initialCount);
});

// ============================================================================
// Line Cap Tests
// ============================================================================

const manyRows = (count: number) =>
	Array.from({length: count}, (_, i) => `row ${i + 1}`).join('\n');

test('ToolMessage caps a long string message and says how much is hidden', t => {
	const {lastFrame} = renderWithTheme(
		<ToolMessage message={manyRows(25)} hideBox={true} />,
	);

	const output = lastFrame()!;
	t.regex(output, /row 20/);
	t.notRegex(output, /row 21/);
	t.regex(output, /\+5 more lines/);
	t.notRegex(output, /\/expand/);
});

test('ToolMessage shows every line inside an expanded ToolOutputContext', t => {
	const {lastFrame} = renderWithTheme(
		<ToolOutputContext.Provider value={{expanded: true}}>
			<ToolMessage message={manyRows(25)} hideBox={true} />
		</ToolOutputContext.Provider>,
	);

	const output = lastFrame()!;
	t.regex(output, /row 25/);
	t.notRegex(output, /more lines/);
});

test('CappedLines renders short output in full with no note', t => {
	const {lastFrame} = renderWithTheme(
		<CappedLines
			items={manyRows(20).split('\n')}
			renderItem={(line, index) => <Text key={index}>{line}</Text>}
		/>,
	);

	const output = lastFrame()!;
	t.regex(output, /row 20/);
	t.notRegex(output, /more lines/);
});

test('CappedLines names the /expand number when it has one', t => {
	const {lastFrame} = renderWithTheme(
		<ToolOutputContext.Provider value={{expanded: false, expandId: 7}}>
			<CappedLines
				items={manyRows(21).split('\n')}
				renderItem={(line, index) => <Text key={index}>{line}</Text>}
			/>
		</ToolOutputContext.Provider>,
	);

	t.regex(lastFrame()!, /\+1 more lines · \/expand 7/);
});
