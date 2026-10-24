import type BigText from 'ink-big-text';
import type Gradient from 'ink-gradient';
import {useEffect, useState} from 'react';

export type BannerModules = {
	BigText: typeof BigText;
	Gradient: typeof Gradient;
};

let loadedBannerModules: BannerModules | null = null;
let bannerModulesPromise: Promise<BannerModules> | undefined;

function loadBannerModules(): Promise<BannerModules> {
	if (loadedBannerModules) return Promise.resolve(loadedBannerModules);

	if (!bannerModulesPromise) {
		bannerModulesPromise = Promise.all([
			import('ink-big-text'),
			import('ink-gradient'),
		])
			.then(([bigText, gradient]) => {
				loadedBannerModules = {
					BigText: bigText.default,
					Gradient: gradient.default,
				};
				return loadedBannerModules;
			})
			.catch((error: unknown) => {
				bannerModulesPromise = undefined;
				throw error;
			});
	}

	return bannerModulesPromise;
}

/** Load the optional banner packages only after a component needs them. */
export function useBannerModules(enabled = true): BannerModules | null {
	const [modules, setModules] = useState<BannerModules | null>(
		() => loadedBannerModules,
	);

	useEffect(() => {
		if (!enabled || modules) return;

		let active = true;
		void loadBannerModules().then(
			loaded => {
				if (active) setModules(loaded);
			},
			() => {
				// Keep the plain-text fallback when the optional modules fail.
			},
		);

		return () => {
			active = false;
		};
	}, [enabled, modules]);

	return modules;
}
