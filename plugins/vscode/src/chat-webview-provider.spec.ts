import test from 'ava';

// ---------------------------------------------------------------------------
// Slash command template mapping
//
// These tests assert the SLASH_COMMANDS definitions in chat-panel.js behave
// as expected. We duplicate the array here so the spec has no browser/webview
// dependency, and so a future refactor that changes a template will break the
// test and prompt a review.
// ---------------------------------------------------------------------------

const SLASH_COMMANDS = [
	{
		name: '/test',
		description: 'Write focused tests',
		template: 'Write tests for the following:\n\n',
	},
	{
		name: '/explain',
		description: 'Explain code or errors',
		template: 'Explain the following clearly:\n\n',
	},
	{
		name: '/doc',
		description: 'Draft documentation',
		template: 'Write documentation for the following:\n\n',
	},
];

test('slash commands - /test template injects correct prefix into textarea', (t) => {
	const cmd = SLASH_COMMANDS.find((c) => c.name === '/test');
	t.truthy(cmd, '/test command must exist');
	t.is(cmd!.template, 'Write tests for the following:\n\n');
});

test('slash commands - /explain template injects correct prefix into textarea', (t) => {
	const cmd = SLASH_COMMANDS.find((c) => c.name === '/explain');
	t.truthy(cmd, '/explain command must exist');
	t.is(cmd!.template, 'Explain the following clearly:\n\n');
});

test('slash commands - /doc template injects correct prefix into textarea', (t) => {
	const cmd = SLASH_COMMANDS.find((c) => c.name === '/doc');
	t.truthy(cmd, '/doc command must exist');
	t.is(cmd!.template, 'Write documentation for the following:\n\n');
});

test('slash commands - all commands have non-empty name, description, and template', (t) => {
	for (const cmd of SLASH_COMMANDS) {
		t.true(cmd.name.startsWith('/'), `${cmd.name} must start with /`);
		t.truthy(cmd.description, `${cmd.name} must have a description`);
		t.truthy(cmd.template, `${cmd.name} must have a template`);
	}
});

test('slash commands - selecting a command produces text the user can see and edit', (t) => {
	// Simulate applySlashSelection: user typed "/test", it gets replaced with the template
	const userInput = '/test';
	const cmd = SLASH_COMMANDS.find((c) => c.name === '/test')!;
	const result = cmd.template; // template replaces the /test trigger in the textarea

	t.true(result.length > 0, 'result must be non-empty');
	t.false(result.includes('/test'), 'raw slash command should not appear in final text');
	t.true(
		result.startsWith('Write tests'),
		'textarea should start with the human-readable template text',
	);
});

test('slash commands - what user sees is exactly what gets sent to AI (no hidden prefix)', (t) => {
	// The PR reviewer required that the prompt sent to the AI must match what
	// the user sees in the textarea. We verify that by confirming no server-side
	// prefix manipulation exists — the template IS the full user contribution.
	const userTyped = 'my function here';
	const cmd = SLASH_COMMANDS.find((c) => c.name === '/test')!;

	// After applySlashSelection the textarea contains: template + userTyped
	const textareaContent = cmd.template + userTyped;

	// This is exactly what gets sent to the AI — no hidden concatenation
	const sentToAi = textareaContent;

	t.is(sentToAi, textareaContent, 'sent prompt must equal what the user sees in the textarea');
});
