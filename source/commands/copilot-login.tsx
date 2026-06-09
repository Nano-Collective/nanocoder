import {runCopilotLoginFlow} from '@/auth/github-copilot';
import {OAuthLogin, type OAuthLoginResult} from './oauth-login.js';

const DEFAULT_PROVIDER_NAME = 'GitHub Copilot';

export type CopilotLoginResult = OAuthLoginResult;

export function CopilotLogin({
	providerName = DEFAULT_PROVIDER_NAME,
	onDone,
}: {
	providerName?: string;
	onDone?: (result: CopilotLoginResult) => void;
}) {
	return (
		<OAuthLogin
			providerName={providerName}
			displayName="GitHub Copilot"
			runFlow={runCopilotLoginFlow}
			onDone={onDone}
		/>
	);
}
