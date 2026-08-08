import {TRUNCATION_OUTPUT_LIMIT} from '@/constants';

const HEAD_SHARE = 0.4;

export function truncateOutputForLLM(
	text: string,
	limit: number = TRUNCATION_OUTPUT_LIMIT,
): string {
	if (text.length <= limit) return text;

	const headLength = Math.floor(limit * HEAD_SHARE);
	const tailLength = limit - headLength;
	const elided = text.length - limit;

	return `${text.slice(0, headLength)}\n... [Output truncated: ${elided} characters elided] ...\n${text.slice(-tailLength)}`;
}
