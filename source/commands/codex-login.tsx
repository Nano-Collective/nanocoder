import {Box, Text, useInput} from 'ink';
import Spinner from 'ink-spinner';
import {useEffect, useState} from 'react';
import {runCodexLoginFlow} from '@/auth/chatgpt-codex';
import {getColors} from '@/config/index';

const DEFAULT_PROVIDER_NAME = 'ChatGPT';

type Status = 'starting' | 'visit' | 'polling' | 'done' | 'error';

export interface CodexLoginResult {
	success: boolean;
	error?: string;
}

export function CodexLogin({
	providerName = DEFAULT_PROVIDER_NAME,
	onDone,
}: {
	providerName?: string;
	onDone?: (result: CodexLoginResult) => void;
}) {
	const colors = getColors();
	const [status, setStatus] = useState<Status>('starting');
	const [verificationUrl, setVerificationUrl] = useState('');
	const [userCode, setUserCode] = useState('');
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				await runCodexLoginFlow(providerName, {
					onShowCode(url, code) {
						if (cancelled) return;
						setVerificationUrl(url);
						setUserCode(code);
						setStatus('visit');
					},
					onPollingStart() {
						if (!cancelled) setStatus('polling');
					},
					delayBeforePollMs: 500,
				});
				if (!cancelled) {
					setStatus('done');
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : String(err));
					setStatus('error');
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [providerName]);

	useInput((_input, key) => {
		if (key.escape) {
			onDone?.({success: false, error: 'Login cancelled.'});
		} else if (key.return && status === 'done') {
			onDone?.({success: true});
		} else if (key.return && status === 'error') {
			onDone?.({success: false, error: error ?? undefined});
		}
	});

	if (status === 'starting') {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Text color={colors.primary}>
					<Spinner type="dots" /> Starting ChatGPT/Codex login…
				</Text>
			</Box>
		);
	}

	if (status === 'visit' || status === 'polling') {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Box marginBottom={1}>
					<Text bold>Visit this URL and enter the code:</Text>
				</Box>
				<Box marginBottom={1}>
					<Text color={colors.primary}>{verificationUrl}</Text>
				</Box>
				<Text bold>Code: {userCode}</Text>
				{status === 'polling' && (
					<Box marginTop={1}>
						<Text color={colors.primary}>
							<Spinner type="dots" /> Waiting for you to complete login…
						</Text>
					</Box>
				)}
			</Box>
		);
	}

	if (status === 'done') {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Box marginBottom={1}>
					<Text color={colors.success}>
						Logged in. Credentials saved for "{providerName}".
					</Text>
				</Box>
				<Text>Press Enter to continue.</Text>
			</Box>
		);
	}

	if (status === 'error') {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Box marginBottom={1}>
					<Text color={colors.error}>{error}</Text>
				</Box>
				<Text>Press Enter to continue.</Text>
			</Box>
		);
	}

	return null;
}
