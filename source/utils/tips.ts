import {TIPS} from '@/constants';

/** Return one tip using an injectable random source for deterministic tests. */
export function getRandomTip(random: () => number = Math.random): string {
	return TIPS[Math.floor(random() * TIPS.length)] ?? TIPS[0];
}
