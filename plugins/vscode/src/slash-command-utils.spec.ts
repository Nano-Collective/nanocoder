import test from 'ava';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/**
 * `media/slash-command-utils.js` ships as a plain browser script, so it is
 * loaded into a VM context here rather than imported. The IIFE assigns onto
 * `globalThis`, which inside a VM context is the sandbox.
 */
const source = readFileSync(
	fileURLToPath(new URL('../media/slash-command-utils.js', import.meta.url)),
	'utf8',
);

const sandbox: Record<string, any> = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const { SLASH_COMMANDS, findSlashCommandToken, applySlashCommand } =
	sandbox.NanocoderSlashCommandUtils;

type SlashCommand = { name: string; description: string; template?: string };

const byName = (name: string): SlashCommand =>
	SLASH_COMMANDS.find((command: SlashCommand) => command.name === name);

test('every command has a name and a description', t => {
	for (const command of SLASH_COMMANDS as SlashCommand[]) {
		t.regex(command.name, /^\/[a-z-]+$/);
		t.truthy(command.description);
	}
});

test('template commands carry visible prompt text, app commands do not', t => {
	t.is(byName('/explain').template, 'Explain the following clearly:\n\n');
	t.is(byName('/test').template, 'Write tests for the following:\n\n');
	t.is(byName('/doc').template, 'Write documentation for the following:\n\n');
	// `/clear` and `/copy` are interpreted by the app, so the menu only
	// completes the name and the existing handlers run it.
	t.is(byName('/clear').template, undefined);
	t.is(byName('/copy').template, undefined);
});

test('a token is only found as the first text on a line', t => {
	t.deepEqual(findSlashCommandToken('/ex', 3, 3), {
		start: 0,
		end: 3,
		query: 'ex',
	});
	t.deepEqual(findSlashCommandToken('code\n  /te', 10, 10), {
		start: 7,
		end: 10,
		query: 'te',
	});
	t.is(findSlashCommandToken('explain this /te', 16, 16), null);
});

test('urls and paths do not open the menu', t => {
	t.is(findSlashCommandToken('https://', 8, 8), null);
	t.is(findSlashCommandToken('open https://', 13, 13), null);
	t.is(findSlashCommandToken('/tmp/', 5, 5), null);
});

test('a range selection or trailing text suppresses the token', t => {
	t.is(findSlashCommandToken('/test', 1, 4), null);
	t.is(findSlashCommandToken('/test code', 5, 5), null);
});

test('applying a template on an empty composer leaves the caret at the end', t => {
	const result = applySlashCommand('/explain', 8, 8, byName('/explain'));

	t.deepEqual(result, {
		text: 'Explain the following clearly:\n\n',
		cursor: 'Explain the following clearly:\n\n'.length,
	});
});

test('applying a template preserves text and line breaks around the command', t => {
	const result = applySlashCommand('first\n/ex\nsecond', 9, 9, byName('/explain'));

	// The token is replaced where it stands: `first` keeps its position above
	// and `second` stays on its own line below, rather than both being folded
	// into one block underneath the template.
	t.deepEqual(result, {
		text: 'first\nExplain the following clearly:\n\n\nsecond',
		cursor: 'first\nExplain the following clearly:\n\n'.length,
	});
});

test('a command with no template completes to its own name', t => {
	t.deepEqual(applySlashCommand('/cl', 3, 3, byName('/clear')), {
		text: '/clear',
		cursor: 6,
	});
});

test('applying returns null when the caret is no longer on a token', t => {
	// The dropdown can outlive the token that opened it if the caret moves
	// without an input event. Callers use the null to fall back to a plain
	// Enter instead of swallowing the keystroke.
	t.is(applySlashCommand('/te and then I moved', 20, 20, byName('/test')), null);
	t.is(applySlashCommand('/te', 3, 3, undefined), null);
});
