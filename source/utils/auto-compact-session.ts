import type {CompressionMode, CompressionStrategy} from '@/types/config';
import {createSessionOverride} from './session-override';

export interface AutoCompactSessionOverrides {
	enabled: boolean | null;
	threshold: number | null;
	mode: CompressionMode | null;
	strategy: CompressionStrategy | null;
}

// Session overrides for auto-compact. `threshold` is clamped to 50–95.
export const autoCompactSession = {
	enabled: createSessionOverride<boolean>(),
	threshold: createSessionOverride<number>(value =>
		value !== null ? Math.max(50, Math.min(95, value)) : null,
	),
	mode: createSessionOverride<CompressionMode>(),
	strategy: createSessionOverride<CompressionStrategy>(),
};

// Legacy object-style accessor (read by useAppHandlers + performAutoCompact).
export const autoCompactSessionOverrides: AutoCompactSessionOverrides =
	new Proxy({} as AutoCompactSessionOverrides, {
		get(_target, prop) {
			if (prop === 'enabled') return autoCompactSession.enabled.get();
			if (prop === 'threshold') return autoCompactSession.threshold.get();
			if (prop === 'mode') return autoCompactSession.mode.get();
			if (prop === 'strategy') return autoCompactSession.strategy.get();
			return undefined;
		},
		set(_target, prop, value) {
			if (prop === 'enabled') autoCompactSession.enabled.set(value);
			else if (prop === 'threshold') autoCompactSession.threshold.set(value);
			else if (prop === 'mode') autoCompactSession.mode.set(value);
			else if (prop === 'strategy') autoCompactSession.strategy.set(value);
			return true;
		},
	});

export function setAutoCompactEnabled(enabled: boolean | null): void {
	autoCompactSession.enabled.set(enabled);
}

export function setAutoCompactThreshold(threshold: number | null): void {
	autoCompactSession.threshold.set(threshold);
}

export function setAutoCompactMode(mode: CompressionMode | null): void {
	autoCompactSession.mode.set(mode);
}

export function setAutoCompactStrategy(
	strategy: CompressionStrategy | null,
): void {
	autoCompactSession.strategy.set(strategy);
}

export function resetAutoCompactSession(): void {
	autoCompactSession.enabled.reset();
	autoCompactSession.threshold.reset();
	autoCompactSession.mode.reset();
	autoCompactSession.strategy.reset();
}
