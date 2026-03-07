import {Box, Text, useInput} from 'ink';
import Spinner from 'ink-spinner';
import {useEffect, useState} from 'react';
import {runCopilotLoginFlow} from '@/auth/github-copilot';
import {colors} from '@/config/index';

const DEFAULT_PROVIDER_NAME = 'GitHub Copilot';

type Status = 'starting' | 'visit' | 'polling' | 'done' | 'error';

export function CopilotLogin({
	providerName = DEFAULT_PROVIDER_NAME,
	onDone,
}: {
	providerName?: string;
	onDone?: () => void;
}) {
	const [status, setStatus] = useState<Status>('starting');
	const [verificationUri, setVerificationUri] = useState('');
	const [userCode, setUserCode] = useState('');
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				await runCopilotLoginFlow(providerName, {
					onShowCode(uri, code) {
						if (cancelled) return;
						setVerificationUri(uri);
						setUserCode(code);
						setStatus('visit');
					},
					onPollingStart() {
						if (!cancelled) setStatus('polling');
					},
					delayBeforePollMs: 500,
				});
				if (cancelled) return;
				setStatus('done');
				onDone?.();
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
	}, [providerName, onDone]);

	// Allow user to dismiss with Enter when done or on error
	useInput((input, key) => {
		if (key.return && (status === 'done' || status === 'error')) {
			onDone?.();
		}
	});

	if (status === 'starting') {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Text color={colors.primary}>
					<Spinner type="dots" /> Starting GitHub Copilot login…
				</Text>
			</Box>
		);
	}

	if (status === 'visit' || status === 'polling') {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Text bold>Visit this URL and enter the code:</Text>
				<Text color={colors.primary}>{verificationUri}</Text>
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
				<Text color="green">
					Logged in. Credential saved for "{providerName}".
				</Text>
				<Text dimColor>Press Enter to continue.</Text>
			</Box>
		);
	}

	if (status === 'error') {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Text color="red">{error}</Text>
				<Text dimColor>Press Enter to continue.</Text>
			</Box>
		);
	}

	return null;
}
