import path from 'path';
import {useCallback, useState} from 'react';
import {loadPreferences, savePreferences} from '@/config/preferences';
import {logError, logInfo} from '@/utils/message-queue';

interface UseDirectoryTrustReturn {
	isTrusted: boolean;
	handleConfirmTrust: () => void;
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
		const preferences = loadPreferences();
		const trustedDirectories = preferences.trustedDirectories || [];
		const normalizedDirectory = path.resolve(directory); // nosemgrep
		const trusted = trustedDirectories.some(
			trustedDir => path.resolve(trustedDir) === normalizedDirectory, // nosemgrep
		);
		return {trusted, error: null};
	} catch (err) {
		const errorMessage =
			err instanceof Error ? err.message : 'Unknown error occurred';
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
	const handleConfirmTrust = useCallback(() => {
		try {
			setError(null);

			const preferences = loadPreferences();
			const trustedDirectories = preferences.trustedDirectories || [];

			// Normalize the directory path before storing and checking
			const normalizedDirectory = path.resolve(directory); // nosemgrep

			// Only add if not already trusted (check using normalized paths)
			if (
				!trustedDirectories.some(
					trustedDir => path.resolve(trustedDir) === normalizedDirectory, // nosemgrep
				)
			) {
				trustedDirectories.push(normalizedDirectory);
				preferences.trustedDirectories = trustedDirectories;
				savePreferences(preferences);

				logInfo(`Directory added to trusted list: ${normalizedDirectory}`);
			}

			setIsTrusted(true);
		} catch (err) {
			const errorMessage =
				err instanceof Error ? err.message : 'Unknown error occurred';
			setError(`Failed to save directory trust: ${errorMessage}`);

			logError(`${errorMessage}`);
		}
	}, [directory]);

	return {
		isTrusted,
		handleConfirmTrust,
		isTrustLoading: false,
		isTrustedError: error,
	};
}
