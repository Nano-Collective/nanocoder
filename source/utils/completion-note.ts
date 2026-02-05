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
	'earnest',
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
