import type {CompressionMode, CompressionStrategy} from '@/types/config';
import {clampThreshold} from './message-compression';
import {createSessionOverride} from './session-override';

export interface AutoCompactSessionOverrides {
	enabled: boolean | null;
	threshold: number | null;
	mode: CompressionMode | null;
	strategy: CompressionStrategy | null;
}

// Session overrides for auto-compact. `threshold` is clamped to the configured range.

// Internal override objects (no longer exposed)
const enabledOverride = createSessionOverride<boolean>();
const thresholdOverride = createSessionOverride<number>(value =>
	value !== null ? clampThreshold(value) : null,
);
const modeOverride = createSessionOverride<CompressionMode>();
const strategyOverride = createSessionOverride<CompressionStrategy>();

// Legacy object-style accessor (read by useAppHandlers + performAutoCompact)
// and used by inline overrides parsing
export const autoCompactSessionOverrides: AutoCompactSessionOverrides =
	new Proxy({} as AutoCompactSessionOverrides, {
		get(_target, prop) {
			if (prop === 'enabled') return enabledOverride.get();
			if (prop === 'threshold') return thresholdOverride.get();
			if (prop === 'mode') return modeOverride.get();
			if (prop === 'strategy') return strategyOverride.get();
			return undefined;
		},
		set(_target, prop, value) {
			if (prop === 'enabled') enabledOverride.set(value);
			else if (prop === 'threshold') thresholdOverride.set(value);
			else if (prop === 'mode') modeOverride.set(value);
			else if (prop === 'strategy') strategyOverride.set(value);
			return true;
		},
	});

export function setAutoCompactEnabled(enabled: boolean | null): void {
	enabledOverride.set(enabled);
}

export function setAutoCompactThreshold(threshold: number | null): void {
	thresholdOverride.set(threshold);
}

export function setAutoCompactMode(mode: CompressionMode | null): void {
	modeOverride.set(mode);
}

export function setAutoCompactStrategy(
	strategy: CompressionStrategy | null,
): void {
	strategyOverride.set(strategy);
}

export const resetAutoCompactSession: () => void = function (): void {
	enabledOverride.reset();
	thresholdOverride.reset();
	modeOverride.reset();
	strategyOverride.reset();
};
