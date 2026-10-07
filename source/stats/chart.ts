/**
 * Vertical column bar chart for `/stats` cumulative series.
 *
 * Y-axis labels use a dynamic fixed gutter sized to the longest label in
 * this render (e.g. "19.2k", "100k", "1.3M") so the plot spine stays
 * column-aligned regardless of magnitude.
 */

import {formatCompactTokenCount} from '@/usage/format';
import type {CumulativePoint} from './types';

const CHART_HEIGHT = 6;
const MAX_BARS = 12;
/** Characters per bar slot (bar glyph + trailing gap). */
const COL_WIDTH = 4;
/** Minimum Y-gutter; grows to fit the longest label this frame. */
const MIN_Y_GUTTER = 4;
/**
 * Hard ceiling so a pathological count can't blow the card width.
 * Compact form tops out around "999.9k" / "1234M" in practice; 8 is roomy.
 */
const MAX_Y_GUTTER = 8;

/**
 * Render cumulative tokens as vertical bars (columns).
 * Rows are top → bottom; `axis` is the label row under the plot.
 */
export function renderCumulativeChart(
	points: CumulativePoint[],
	options?: {height?: number; width?: number},
): {rows: string[]; axis: string} {
	const height = options?.height ?? CHART_HEIGHT;
	if (points.length === 0) {
		return {rows: Array.from({length: height}, () => ''), axis: ''};
	}

	const maxPlotWidth = Math.max(
		16,
		(options?.width ?? 48) - (MAX_Y_GUTTER + 2),
	);
	const maxBarsByWidth = Math.max(1, Math.floor(maxPlotWidth / COL_WIDTH));
	const maxBars = Math.min(MAX_BARS, maxBarsByWidth);
	const sampled = samplePoints(points, maxBars);
	const maxTokens = Math.max(...sampled.map(p => p.cumulativeTokens), 1);
	const plotWidth = sampled.length * COL_WIDTH;

	// --- Y labels: format first, then size gutter to the widest ---
	const rawYLabels: string[] = [];
	for (let row = 0; row < height; row++) {
		const tokensAtRow =
			maxTokens * ((height - 1 - row) / Math.max(1, height - 1));
		rawYLabels.push(formatYAxisLabel(tokensAtRow));
	}
	const gutterWidth = clamp(
		Math.max(MIN_Y_GUTTER, ...rawYLabels.map(displayWidth)),
		MIN_Y_GUTTER,
		MAX_Y_GUTTER,
	);
	const yLabels = rawYLabels.map(label => padStartDisplay(label, gutterWidth));

	// grid[row][col] — row 0 is top
	const grid: string[][] = Array.from({length: height}, () =>
		Array.from({length: plotWidth}, () => ' '),
	);

	for (let i = 0; i < sampled.length; i++) {
		const point = sampled[i];
		if (!point) continue;
		const barHeight =
			maxTokens <= 0
				? 0
				: Math.max(
						point.cumulativeTokens > 0 ? 1 : 0,
						Math.round((point.cumulativeTokens / maxTokens) * height),
					);
		const barCol = i * COL_WIDTH + 1;
		for (let h = 0; h < barHeight; h++) {
			const row = height - 1 - h;
			const line = grid[row];
			if (line && barCol < plotWidth) {
				line[barCol] = '█';
			}
		}
	}

	// Row layout: [Y-label][space][spine][bars...]
	// Axis labels must start at the same column as bars (gutter + 2).
	const rows = grid.map((cols, row) => {
		const spine = row === height - 1 ? '└' : '┤';
		return `${yLabels[row]} ${spine}${cols.join('')}`;
	});

	const labelCells = sampled.map(p => centerLabel(p.label, COL_WIDTH));
	const axis = `${' '.repeat(gutterWidth + 2)}${labelCells.join('')}`.trimEnd();

	const maxRow = Math.max(20, (options?.width ?? 48) + gutterWidth);
	return {
		rows: rows.map(r => truncateDisplay(r, maxRow)),
		axis: truncateDisplay(axis, maxRow),
	};
}

/**
 * Compact token label for the Y axis. Uses the shared compact formatter
 * and clamps display length so the gutter stays bounded.
 */
export function formatYAxisLabel(tokens: number): string {
	if (!Number.isFinite(tokens) || tokens <= 0) {
		return '0';
	}
	const formatted = formatCompactTokenCount(tokens);
	if (displayWidth(formatted) <= MAX_Y_GUTTER) {
		return formatted;
	}
	// Extremely large: fall back to scientific-ish short form via millions/billions.
	if (tokens >= 1_000_000_000) {
		return `${trimOneDecimal(tokens / 1_000_000_000)}B`;
	}
	if (tokens >= 1_000_000) {
		return `${trimOneDecimal(tokens / 1_000_000)}M`;
	}
	return truncateDisplay(formatted, MAX_Y_GUTTER);
}

function trimOneDecimal(value: number): string {
	if (value >= 100) return String(Math.round(value));
	return value.toFixed(1).replace(/\.0$/, '');
}

function displayWidth(text: string): number {
	return [...text].length;
}

function padStartDisplay(text: string, width: number): string {
	const w = displayWidth(text);
	if (w >= width) return truncateDisplay(text, width);
	return `${' '.repeat(width - w)}${text}`;
}

function truncateDisplay(text: string, max: number): string {
	const chars = [...text];
	if (chars.length <= max) return text;
	return chars.slice(0, max).join('');
}

function centerLabel(text: string, width: number): string {
	const label = [...text].slice(0, width).join('');
	const pad = width - displayWidth(label);
	const left = Math.floor(pad / 2);
	return `${' '.repeat(left)}${label}${' '.repeat(pad - left)}`;
}

function clamp(n: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, n));
}

/** Evenly sample points keeping first and last when over the cap. */
function samplePoints(
	points: CumulativePoint[],
	max: number,
): CumulativePoint[] {
	if (points.length <= max) return points;
	const out: CumulativePoint[] = [];
	for (let i = 0; i < max; i++) {
		const idx =
			i === max - 1
				? points.length - 1
				: Math.round((i * (points.length - 1)) / (max - 1));
		const point = points[idx];
		if (point) out.push(point);
	}
	return out.filter((p, i, arr) => i === 0 || p.key !== arr[i - 1]?.key);
}
