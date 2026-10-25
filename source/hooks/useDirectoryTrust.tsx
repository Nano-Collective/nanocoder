import path from 'path';
import {useCallback, useState} from 'react';
import {
	ensureDirectoryTrust,
	grantDirectoryTrust,
	isDirectoryTrusted,
	loadPreferences,
	savePreferences,
} from '@/config/preferences';
import {formatError} from '@/utils/error-formatter';
import {logError, logInfo, logWarning} from '@/utils/message-queue';

interface UseDirectoryTrustReturn {
	isTrusted: boolean;
	handleConfirmTrust: (shownFingerprint?: string) => void;
	isTrustLoading: boolean;
	isTrustedError: string | null;
}

/**
 * Check trust status synchronously. This is pure filesystem work
 * (readFileSync for preferences) and path comparison — microseconds.
 * Computing it synchronously in useState avoids a one-frame flash of
 * the "Checking directory trust..." spinner.
 */
function checkTrustSync(directory: string): {
	trusted: boolean;
	error: string | null;
} {
	try {
		// Same resolution as --plain, ACP and the daemon, including
		// NANOCODER_TRUST_DIRECTORY=1 recording the folder as trusted. A
		// project .env cannot set that variable (see project-dotenv), so only
		// the user's own shell can skip the disclaimer this way.
		const trust = ensureDirectoryTrust(directory, false);
		if (trust.persisted) {
			logInfo(
				`Marked ${path.resolve(directory)} as trusted (NANOCODER_TRUST_DIRECTORY=1).`, // nosemgrep
			);
		} else if (trust.persistFailed) {
			logWarning(
				'NANOCODER_TRUST_DIRECTORY=1 trusted this directory for this run, but saving it to your preferences failed.',
			);
		}
		return {trusted: trust.trusted, error: null};
	} catch (err) {
		const errorMessage = formatError(err);
		logError(`${errorMessage}`);
		return {
			trusted: false,
			error: `Failed to check directory trust status: ${errorMessage}`,
		};
	}
}

/**
 * Custom hook for managing directory trust functionality.
 * Handles checking if a directory is trusted and adding it to trusted directories.
 *
 * @param directory - The directory path to check trust for (defaults to current working directory)
 * @returns Object containing trust state and handler functions
 */
export function useDirectoryTrust(
	directory: string = process.cwd(),
): UseDirectoryTrustReturn {
	// Compute trust status synchronously on first render — the check is
	// pure sync filesystem + path comparison, so there's no reason to
	// defer it to a useEffect (which would flash a loading spinner for
	// one frame before the effect runs).
	const [initial] = useState(() => checkTrustSync(directory));
	const [isTrusted, setIsTrusted] = useState(initial.trusted);
	const [error, setError] = useState<string | null>(initial.error);

	// Handler to confirm trust for the current directory
	const handleConfirmTrust = useCallback(
		(shownFingerprint?: string) => {
			try {
				setError(null);

				const preferences = loadPreferences();

				if (!isDirectoryTrusted(directory, preferences)) {
					const granted = grantDirectoryTrust(
						preferences,
						directory,
						shownFingerprint,
					);
					savePreferences(granted);
					logInfo(
						`Directory added to trusted list: ${path.resolve(directory)}`, // nosemgrep
					);
				}

				setIsTrusted(true);
			} catch (err) {
				const errorMessage = formatError(err);
				setError(`Failed to save directory trust: ${errorMessage}`);

				logError(`${errorMessage}`);
			}
		},
		[directory],
	);

	return {
		isTrusted,
		handleConfirmTrust,
		isTrustLoading: false,
		isTrustedError: error,
	};
}
