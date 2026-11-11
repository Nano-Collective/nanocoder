import test from 'ava';
import {getAppConfig} from '@/config/index';
import type {AppConfig} from '@/types/config';
import {bashChildEnv} from './bash-env.js';
import {BashExecutor} from './bash-executor.js';

console.log('\nbash-env.spec.ts');

const KEY = 'sk-test-0123456789abcdef0123';

const config = {
	providers: [
		{name: 'Main', models: ['m'], apiKey: KEY},
		{name: 'Local', models: ['m'], apiKey: 'ollama'},
	],
	nanocoderTools: {webSearch: {apiKey: 'brave-0123456789abcdef'}},
} as AppConfig;

const env = {
	MY_LLM_KEY: KEY,
	SEARCH: 'brave-0123456789abcdef',
	NANOCODER_PROVIDERS: '[{"name":"x","apiKey":"secret"}]',
	OPENAI_API_KEY: 'sk-other-key-not-configured-here',
	GH_TOKEN: 'ghp_users_own_token_for_gh_cli',
	PROVIDER: 'ollama',
	PATH: '/usr/bin',
};

test('bashChildEnv drops variables holding nanocoder provider keys, keeps the rest', t => {
	const result = bashChildEnv(env, config, false);
	t.is(result.MY_LLM_KEY, undefined);
	t.is(result.SEARCH, undefined);
	t.is(result.NANOCODER_PROVIDERS, undefined);
	// Outside the jail a project may need its own provider keys, and gh its token.
	t.is(result.OPENAI_API_KEY, env.OPENAI_API_KEY);
	t.is(result.GH_TOKEN, env.GH_TOKEN);
	// A short placeholder apiKey must not strip an unrelated variable.
	t.is(result.PROVIDER, 'ollama');
	t.is(result.PATH, '/usr/bin');
});

test('bashChildEnv in sandbox mode also drops well-known provider key variables', t => {
	const result = bashChildEnv(env, config, true);
	t.is(result.OPENAI_API_KEY, undefined);
	t.is(result.MY_LLM_KEY, undefined);
	t.is(result.GH_TOKEN, env.GH_TOKEN);
});

test.serial('execute_bash children do not see the configured provider key', async t => {
	if (process.platform === 'win32') {
		t.pass();
		return;
	}
	const appConfig = getAppConfig();
	const previous = appConfig.providers;
	appConfig.providers = config.providers;
	process.env.NC_BASH_ENV_SPEC_KEY = KEY;
	process.env.NC_BASH_ENV_SPEC_OTHER = 'kept';
	try {
		const result = await new BashExecutor().execute(
			'echo "key=${NC_BASH_ENV_SPEC_KEY-unset} other=${NC_BASH_ENV_SPEC_OTHER-unset}"',
		).promise;
		t.is(result.fullOutput.trim(), 'key=unset other=kept');
	} finally {
		appConfig.providers = previous;
		delete process.env.NC_BASH_ENV_SPEC_KEY;
		delete process.env.NC_BASH_ENV_SPEC_OTHER;
	}
});
