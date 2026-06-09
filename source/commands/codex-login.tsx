import {runCodexLoginFlow} from '@/auth/chatgpt-codex';
import {OAuthLogin, type OAuthLoginResult} from './oauth-login.js';

const DEFAULT_PROVIDER_NAME = 'ChatGPT';

export type CodexLoginResult = OAuthLoginResult;

export function CodexLogin({
	providerName = DEFAULT_PROVIDER_NAME,
	onDone,
}: {
	providerName?: string;
	onDone?: (result: CodexLoginResult) => void;
}) {
	return (
		<OAuthLogin
			providerName={providerName}
			displayName="ChatGPT/Codex"
			runFlow={runCodexLoginFlow}
			onDone={onDone}
		/>
	);
}
