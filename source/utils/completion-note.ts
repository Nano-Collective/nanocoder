import {getProfessionalTone} from '@/config/preferences';

const adjectives = [
	'brisk',
	'swift',
	'breezy',
	'thoughtful',
	'steady',
	'snappy',
	'crisp',
	'diligent',
	'nimble',
	'spirited',
	'keen',
	'zippy',
	'lively',
	'focused',
	'peppy',
	'resolute',
	'deft',
	'plucky',
	'hearty',
	'jaunty',
	'sprightly',
	'tenacious',
	'chipper',
];

export const getRandomAdjective = (): string => {
	const index = Math.floor(Math.random() * adjectives.length);
	return adjectives[index] ?? adjectives[0] ?? 'brisk';
};

export const formatElapsedTime = (startTime: number): string => {
	const elapsed = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
	const minutes = Math.floor(elapsed / 60);
	const seconds = elapsed % 60;

	if (minutes > 0) {
		return `${minutes}m ${seconds}s`;
	}
	return `${seconds}s`;
};

/**
 * Build the end-of-turn progress note. Professional tone strips the random
 * adjective so the line stays strictly functional.
 */
export const buildCompletionNote = (
	startTime: number,
	professionalTone: boolean = getProfessionalTone(),
): string => {
	const elapsed = formatElapsedTime(startTime);
	return professionalTone
		? `Completed in ${elapsed}.`
		: `Worked for a ${getRandomAdjective()} ${elapsed}.`;
};
