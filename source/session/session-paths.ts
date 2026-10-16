import path from 'node:path';
import {getAppDataPath} from '@/config/paths';

/** Resolve the configured session store without initializing or cleaning it. */
export function getSessionsDirectory(configuredDir?: string): string {
	if (!configuredDir) return path.join(getAppDataPath(), 'sessions');

	if (configuredDir === '~') {
		return path.resolve(process.env.HOME || process.env.USERPROFILE || '.');
	}
	if (configuredDir.startsWith('~/')) {
		return path.join(
			process.env.HOME || process.env.USERPROFILE || '.',
			configuredDir.slice(2),
		);
	}
	return configuredDir;
}
