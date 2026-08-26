import test from 'ava';
import {formatYAxisLabel, renderCumulativeChart} from './chart';

console.log('\nchart.spec.ts');

test('renderCumulativeChart draws vertical bars for rising series', t => {
	const {rows, axis} = renderCumulativeChart(
		[
			{key: '2026-03', label: 'Mar', cumulativeTokens: 100},
			{key: '2026-04', label: 'Apr', cumulativeTokens: 200},
			{key: '2026-05', label: 'May', cumulativeTokens: 350},
			{key: '2026-06', label: 'Jun', cumulativeTokens: 500},
		],
		{width: 40, height: 6},
	);
	t.is(rows.length, 6);
	t.true(rows.some(r => r.includes('█')));
	t.regex(axis, /Mar/);
	t.regex(axis, /Jun/);
	const topBars = (rows[0]?.match(/█/g) ?? []).length;
	const bottomBars = (rows[5]?.match(/█/g) ?? []).length;
	t.true(bottomBars >= topBars);
});

test('Y-axis spines stay column-aligned when labels include decimals (19.2k)', t => {
	// Peak ~19200 → labels like 19.2k, 14.4k, 9.6k, 4.8k, 0
	const {rows} = renderCumulativeChart(
		[
			{key: 'd1', label: 'Wed', cumulativeTokens: 5_000},
			{key: 'd2', label: 'Thu', cumulativeTokens: 10_000},
			{key: 'd3', label: 'Fri', cumulativeTokens: 19_200},
		],
		{width: 40, height: 5},
	);

	const spineIndexes = rows.map(row => {
		const idx = row.indexOf('┤');
		return idx === -1 ? row.indexOf('└') : idx;
	});
	t.true(spineIndexes.every(i => i > 0));
	t.true(spineIndexes.every(i => i === spineIndexes[0]));

	// Gutter must fit "19.2k" (5 chars) — spine at index >= 5
	t.true((spineIndexes[0] ?? 0) >= 5);
	t.true(rows.some(r => r.includes('19.2k') || r.includes('19k')));
});

test('Y-axis stays aligned for 100k and 1.3M scale labels', t => {
	const cases = [
		{peak: 100_000, fragment: '100k'},
		{peak: 1_300_000, fragment: '1.3M'},
	];
	for (const {peak, fragment} of cases) {
		const {rows} = renderCumulativeChart(
			[
				{key: 'a', label: 'A', cumulativeTokens: peak / 2},
				{key: 'b', label: 'B', cumulativeTokens: peak},
			],
			{width: 40, height: 5},
		);
		const spines = rows.map(r => {
			const i = r.indexOf('┤');
			return i === -1 ? r.indexOf('└') : i;
		});
		t.true(spines.every(i => i === spines[0]), `aligned for ${fragment}`);
		t.true(
			rows.some(r => r.includes(fragment) || r.includes(fragment.replace('.0', ''))),
			`label present for ${fragment}`,
		);
	}
});

test('formatYAxisLabel covers compact edge cases', t => {
	t.is(formatYAxisLabel(0), '0');
	t.is(formatYAxisLabel(999), '999');
	t.regex(formatYAxisLabel(4_200), /^4\.2k$/);
	t.regex(formatYAxisLabel(100_000), /^100k$/);
	t.regex(formatYAxisLabel(1_300_000), /^1\.3M$/);
	t.true([...formatYAxisLabel(19_200)].length <= 8);
	t.true([...formatYAxisLabel(9_999_999_999)].length <= 8);
});

test('renderCumulativeChart empty points', t => {
	const {rows, axis} = renderCumulativeChart([]);
	t.is(rows.length, 6);
	t.is(axis, '');
});

test('renderCumulativeChart stays within width budget', t => {
	const points = Array.from({length: 40}, (_, i) => ({
		key: `2026-${String(i + 1).padStart(2, '0')}`,
		label: `M${i + 1}`,
		cumulativeTokens: (i + 1) * 1000,
	}));
	const width = 36;
	const {rows, axis} = renderCumulativeChart(points, {width, height: 6});
	t.true(rows.every(r => r.length <= width + 10));
	t.true(axis.length <= width + 10);
});
