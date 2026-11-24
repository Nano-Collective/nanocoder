// Decode HTML entities
export function decodeHtmlEntities(text: string): string {
	const entities: Record<string, string> = {
		'&nbsp;': ' ',
		'&amp;': '&',
		'&lt;': '<',
		'&gt;': '>',
		'&quot;': '"',
		'&apos;': "'",
		'&copy;': '©',
		'&reg;': '®',
		'&trade;': '™',
		'&euro;': '€',
		'&pound;': '£',
		'&yen;': '¥',
		'&cent;': '¢',
		'&sect;': '§',
		'&deg;': '°',
		'&plusmn;': '±',
		'&times;': '×',
		'&divide;': '÷',
		'&ndash;': '–',
		'&mdash;': '—',
		'&lsquo;': '\u2018',
		'&rsquo;': '\u2019',
		'&ldquo;': '\u201C',
		'&rdquo;': '\u201D',
		'&hellip;': '…',
		'&bull;': '•',
	};

	// One pass, so the output of a replacement is never decoded again
	// (`&amp;lt;` must stay `&lt;`).
	return text.replace(
		/&(?:#(\d+)|#[xX]([0-9A-Fa-f]+)|[a-z]+);/g,
		(match, dec: string | undefined, hex: string | undefined) => {
			if (dec === undefined && hex === undefined) {
				return entities[match] ?? match;
			}
			const code = dec ? parseInt(dec, 10) : parseInt(hex ?? '', 16);
			return code <= 0x10ffff ? String.fromCodePoint(code) : match;
		},
	);
}
