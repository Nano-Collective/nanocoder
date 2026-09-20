import test from 'ava';
import {themes} from '@/config/themes';

/** Relative luminance per WCAG 2.1. */
function luminance(hex: string): number {
	const raw = hex.replace('#', '');
	const channels = [0, 2, 4].map(i => {
		const c = Number.parseInt(raw.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return (
		0.2126 * (channels[0] ?? 0) +
		0.7152 * (channels[1] ?? 0) +
		0.0722 * (channels[2] ?? 0)
	);
}

function contrastRatio(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const entries = Object.entries(themes);

test('every theme defines a hex primary and base', t => {
	for (const [name, theme] of entries) {
		t.regex(theme.colors.primary, /^#[0-9a-f]{6}$/i, `${name} primary`);
		t.regex(theme.colors.base, /^#[0-9a-f]{6}$/i, `${name} base`);
	}
});

// `primary` is the selection highlight in StyledSelectInput, so a low-contrast
// value makes the highlighted row unreadable — the bug reported in issue #827.
// 3:1 is the WCAG AA floor for large text and UI components.
test('primary contrasts at least 3:1 against base in every theme', t => {
	const failures = entries
		.map(([name, theme]) => ({
			name,
			ratio: contrastRatio(theme.colors.primary, theme.colors.base),
		}))
		.filter(({ratio}) => ratio < 3)
		.map(({name, ratio}) => `${name} (${ratio.toFixed(2)}:1)`);

	t.deepEqual(failures, [], `low-contrast highlight: ${failures.join(', ')}`);
});

test('text contrasts at least 4.5:1 against base in every theme', t => {
	const failures = entries
		.map(([name, theme]) => ({
			name,
			ratio: contrastRatio(theme.colors.text, theme.colors.base),
		}))
		.filter(({ratio}) => ratio < 4.5)
		.map(({name, ratio}) => `${name} (${ratio.toFixed(2)}:1)`);

	t.deepEqual(failures, [], `low-contrast body text: ${failures.join(', ')}`);
});

test('themeType matches whether base is actually light or dark', t => {
	for (const [name, theme] of entries) {
		const isLight = luminance(theme.colors.base) > 0.5;
		t.is(
			theme.themeType,
			isLight ? 'light' : 'dark',
			`${name} base ${theme.colors.base} is mislabelled`,
		);
	}
});
