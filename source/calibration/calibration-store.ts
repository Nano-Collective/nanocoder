import {loadPreferences, savePreferences} from '@/config/preferences';
import type {CalibrationProfile} from '@/types/calibration';

export function getCalibrationKey(provider: string, model: string): string {
	return `${provider.toLowerCase().trim()}:${model.toLowerCase().trim()}`;
}

export function getAllCalibrationProfiles(): Record<
	string,
	CalibrationProfile
> {
	const prefs = loadPreferences();
	return prefs.modelCalibrations ?? {};
}

export function getCalibrationProfile(
	provider: string,
	model: string,
): CalibrationProfile | undefined {
	const profiles = getAllCalibrationProfiles();
	const key = getCalibrationKey(provider, model);
	return profiles[key];
}

export function saveCalibrationProfile(profile: CalibrationProfile): void {
	const prefs = loadPreferences();
	const key = getCalibrationKey(profile.provider, profile.model);

	const updatedCalibrations = {
		...(prefs.modelCalibrations ?? {}),
		[key]: profile,
	};

	savePreferences({
		...prefs,
		modelCalibrations: updatedCalibrations,
	});
}

export function clearCalibrationProfile(
	provider?: string,
	model?: string,
): void {
	const prefs = loadPreferences();
	if (!prefs.modelCalibrations) return;

	if (provider && model) {
		const key = getCalibrationKey(provider, model);
		const updated = {...prefs.modelCalibrations};
		delete updated[key];
		savePreferences({
			...prefs,
			modelCalibrations: updated,
		});
	} else if (provider) {
		const providerPrefix = `${provider.toLowerCase().trim()}:`;
		const updated: Record<string, CalibrationProfile> = {};
		for (const [k, v] of Object.entries(prefs.modelCalibrations)) {
			if (!k.startsWith(providerPrefix)) {
				updated[k] = v;
			}
		}
		savePreferences({
			...prefs,
			modelCalibrations: updated,
		});
	} else {
		savePreferences({
			...prefs,
			modelCalibrations: {},
		});
	}
}
