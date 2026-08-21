import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import test from 'ava';

const slashCommandUtilsSource = readFileSync(
	fileURLToPath(new URL('../media/slash-command-utils.js', import.meta.url)),
	'utf8',
);
const chatPanelScript = readFileSync(
	fileURLToPath(new URL('../media/chat-panel.js', import.meta.url)),
	'utf8',
);
const chatWebviewProviderSource = readFileSync(
	fileURLToPath(new URL('./chat-webview-provider.ts', import.meta.url)),
	'utf8',
);

const sandbox: Record<string, any> = {};
vm.createContext(sandbox);
vm.runInContext(slashCommandUtilsSource, sandbox);

const {
	SLASH_COMMANDS,
	findSlashCommandToken,
	applySlashCommandTemplate,
	isSlashCommandName,
} = sandbox.NanocoderSlashCommandUtils;

test('slash commands - real command definitions expose user-visible templates', t => {
	t.deepEqual(
		SLASH_COMMANDS.map((command: {name: string; template: string}) => ({
			name: command.name,
			template: command.template,
		})),
		[
			{name: '/test', template: 'Write tests for the following:\n\n'},
			{name: '/explain', template: 'Explain the following clearly:\n\n'},
			{name: '/doc', template: 'Write documentation for the following:\n\n'},
		],
	);
});

test('slash commands - command token is only found as first text on a line', t => {
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
	t.is(findSlashCommandToken('https://', 8, 8), null);
	t.is(findSlashCommandToken('open https://', 13, 13), null);
	t.is(findSlashCommandToken('/tmp/', 5, 5), null);
});

test('slash commands - command token ignores selections and trailing text', t => {
	t.is(findSlashCommandToken('/test', 1, 4), null);
	t.is(findSlashCommandToken('/test code', 5, 5), null);
});

test('slash commands - applying a command prepends visible template to existing text', t => {
	const command = SLASH_COMMANDS.find((item: {name: string}) => item.name === '/explain');
	const result = applySlashCommandTemplate('code\n/explain', 13, 13, command);

	t.deepEqual(result, {
		text: 'Explain the following clearly:\n\ncode',
		cursor: 'Explain the following clearly:\n\n'.length,
	});
});

test('slash commands - command names are not treated as attachment chips', t => {
	t.true(isSlashCommandName('/explain'));
	t.true(isSlashCommandName(' /explain '));
	t.true(isSlashCommandName('/test'));
	t.false(isSlashCommandName('/tmp'));
	t.true(chatPanelScript.includes('if (isSlashCommandName(path) || isSlashCommandName(name)) break;'));
	t.true(chatPanelScript.includes('!isSlashCommandName(item.path) && !isSlashCommandName(item.name)'));
	t.true(chatPanelScript.includes('function removeSlashCommandChipsFromDom()'));
	t.true(chatPanelScript.includes('removeSlashCommandChipsFromDom();'));
});

test('slash commands - no hidden prompt state remains in chat-panel runtime', t => {
	t.true(chatPanelScript.includes('globalThis.NanocoderSlashCommandUtils ||'));
	t.true(chatPanelScript.includes('applySlashCommandTemplate('));
	t.false(chatPanelScript.includes('selectedSlashCommand'));
	t.false(chatPanelScript.includes('command: selectedSlashCommand'));
	t.false(chatPanelScript.includes('_buildPrompt'));
});

test('webview assets include file mtime in cache key for extension dev mode', t => {
	t.true(chatWebviewProviderSource.includes('fs.statSync(assetPath).mtimeMs'));
	t.true(chatWebviewProviderSource.includes("assetVersion('chat-panel.js')"));
	t.true(chatWebviewProviderSource.includes("assetVersion('slash-command-utils.js')"));
});
