import {useCallback, useEffect, useState} from 'react';
import {loadAdditionalDirectoriesConfig} from '@/config/index';
import {loadPreferences, savePreferences} from '@/config/preferences';
import {
	ensureDirectoryTrust,
	grantDirectoryTrust,
} from '@/config/trust/directory-trust';
import {
	addWorkingDirectory,
	getCliDirectories,
	prepareWorkingDirectory,
	type WorkingDirectory,
} from '@/services/working-directories';
import {formatError} from '@/utils/error-formatter';

/** Gate initialization until every requested directory has passed the normal trust check. */
export function useAdditionalDirectories(
	primaryTrusted: boolean,
	bypass: boolean,
) {
	const [pending, setPending] = useState<WorkingDirectory | null>(null);
	const [ready, setReady] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [revision, setRevision] = useState(0);
	useEffect(() => {
		void revision; // A confirmed prompt retries the trust checks.
		if (!primaryTrusted) return;
		try {
			for (const directory of [
				...loadAdditionalDirectoriesConfig(),
				...getCliDirectories(),
			]) {
				const prepared = prepareWorkingDirectory(directory);
				if (!ensureDirectoryTrust(prepared.path, bypass).trusted) {
					setPending(prepared);
					return;
				}
				addWorkingDirectory(prepared, bypass);
			}
			setPending(null);
			setReady(true);
		} catch (error) {
			setError(formatError(error));
		}
	}, [primaryTrusted, bypass, revision]);
	const confirm = useCallback(
		(fingerprint: string) => {
			if (!pending) return;
			try {
				if (
					savePreferences(
						grantDirectoryTrust(loadPreferences(), pending.path, fingerprint),
					) === false
				)
					throw new Error('Could not save directory trust');
				setPending(null);
				setRevision(value => value + 1);
			} catch (error) {
				setError(formatError(error));
			}
		},
		[pending],
	);
	return {pending, ready, error, confirm};
}
