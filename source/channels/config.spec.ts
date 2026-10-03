import test from 'ava';
import {
	configuredPlatforms,
	DEFAULT_CHANNEL_HISTORY_TURNS,
	MAX_CHANNEL_HISTORY_TURNS,
	parseChannelsConfig,
} from './config';

console.log(`\nchannels/config.spec.ts`);

test('parses every platform and coerces numeric ids to strings', t => {
	const {config, warnings} = parseChannelsConfig({
		telegram: {token: ' 123:abc ', allowedUsers: [42, '43'], allowedChats: [-100]},
		slack: {botToken: 'xoxb-1', appToken: 'xapp-1', allowedUsers: ['U1'], mode: 'plan'},
		discord: {token: 'd-1', allowedUsers: ['9']},
		historyTurns: 3,
		timeoutMs: 5000,
	});

	t.deepEqual(warnings, []);
	t.deepEqual(config, {
		telegram: {token: '123:abc', allowedUsers: ['42', '43'], allowedChats: ['-100']},
		slack: {botToken: 'xoxb-1', appToken: 'xapp-1', allowedUsers: ['U1'], mode: 'plan'},
		discord: {token: 'd-1', allowedUsers: ['9']},
		historyTurns: 3,
		timeoutMs: 5000,
	});
	t.deepEqual(configuredPlatforms(config), ['telegram', 'slack', 'discord']);
});

test('a platform without its token is disabled with a warning', t => {
	const {config, warnings} = parseChannelsConfig({
		telegram: {allowedUsers: ['1']},
		slack: {botToken: 'xoxb', allowedUsers: ['U1']},
	});

	t.is(config.telegram, undefined);
	t.is(config.slack, undefined);
	t.deepEqual(warnings, [
		'telegram.token is missing; channel disabled',
		'slack.appToken is missing; channel disabled',
	]);
});

test('an unresolved ${VAR} token is reported, not used as a credential', t => {
	const {config, warnings} = parseChannelsConfig({
		discord: {token: '${DISCORD_BOT_TOKEN}', allowedUsers: ['1']},
	});

	t.is(config.discord, undefined);
	t.is(warnings.length, 1);
	t.regex(warnings[0] ?? '', /DISCORD_BOT_TOKEN.*environment variable/);
});

test('an empty allowedUsers list disables the platform', t => {
	const {config, warnings} = parseChannelsConfig({
		telegram: {token: 't', allowedUsers: []},
		discord: {token: 'd'},
	});

	t.deepEqual(configuredPlatforms(config), []);
	t.is(warnings.length, 2);
	for (const warning of warnings) t.regex(warning, /allowedUsers is empty/);
});

test('malformed entries are skipped individually and reported', t => {
	const {config, warnings} = parseChannelsConfig({
		telegram: {
			token: 't',
			allowedUsers: ['1', null, '', {id: 2}],
			allowedChats: 'not-a-list',
			mode: 'yolo',
		},
	});

	t.deepEqual(config.telegram, {token: 't', allowedUsers: ['1'], allowedChats: []});
	t.deepEqual(warnings, [
		'telegram.allowedUsers entry null ignored',
		'telegram.allowedUsers entry "" ignored',
		'telegram.allowedUsers entry {"id":2} ignored',
		'telegram.allowedChats must be an array of ids',
		'telegram.mode must be "headless" or "plan" (got "yolo"); using headless',
	]);
});

test('historyTurns and timeoutMs are validated and clamped', t => {
	const tooMany = parseChannelsConfig({historyTurns: 999});
	t.is(tooMany.config.historyTurns, MAX_CHANNEL_HISTORY_TURNS);
	t.deepEqual(tooMany.warnings, []);

	const bad = parseChannelsConfig({historyTurns: -1, timeoutMs: 10});
	t.is(bad.config.historyTurns, undefined);
	t.is(bad.config.timeoutMs, undefined);
	t.is(bad.warnings.length, 2);
	t.regex(bad.warnings[0] ?? '', new RegExp(`using ${DEFAULT_CHANNEL_HISTORY_TURNS}`));
	t.regex(bad.warnings[1] ?? '', /timeoutMs must be a number >= 1000/);
});

test('unknown keys and non-object blocks are reported', t => {
	const {config, warnings} = parseChannelsConfig({
		telegram: 'oops',
		whatsapp: {token: 'x'},
	});

	t.deepEqual(config, {});
	t.deepEqual(warnings, [
		'telegram must be an object; channel disabled',
		'unknown key "whatsapp" ignored',
	]);

	t.deepEqual(parseChannelsConfig('nope').warnings, ['must be an object; ignoring']);
	t.deepEqual(configuredPlatforms(undefined), []);
});
