/**
 * Type definitions for the structured logging system
 */

export type LogLevel =
	| 'silent'
	| 'fatal'
	| 'error'
	| 'warn'
	| 'info'
	| 'http'
	| 'debug'
	| 'trace';

export interface LoggerConfig {
	level: LogLevel;
	destination?: string;
	pretty: boolean;
	redact: string[];
	correlation: boolean;
	serialize: boolean;
	transport?: unknown;
}

// Enhanced logger configuration types
export interface EnhancedLoggerConfig extends LoggerConfig {
	options?: EnhancedTransportOptions;
	[key: string]: unknown;
}

export interface EnhancedTransportOptions {
	destination?: string | number;
	level?: LogLevel;
	translateTime?: string;
	ignore?: string;
	messageFormat?: string;
	customPrettifiers?: Record<string, (data: unknown) => string>;
	levelFirst?: boolean;
	singleLine?: boolean;
	colorize?: boolean;
	[key: string]: unknown;
}

export interface Logger {
	fatal: ((msg: string, ...args: unknown[]) => void) &
		((obj: object, msg?: string) => void);
	error: ((msg: string, ...args: unknown[]) => void) &
		((obj: object, msg?: string) => void);
	warn: ((msg: string, ...args: unknown[]) => void) &
		((obj: object, msg?: string) => void);
	info: ((msg: string, ...args: unknown[]) => void) &
		((obj: object, msg?: string) => void);
	http: ((msg: string, ...args: unknown[]) => void) &
		((obj: object, msg?: string) => void);
	debug: ((msg: string, ...args: unknown[]) => void) &
		((obj: object, msg?: string) => void);
	trace: ((msg: string, ...args: unknown[]) => void) &
		((obj: object, msg?: string) => void);

	child(bindings: Record<string, unknown>): Logger;
	isLevelEnabled(level: LogLevel): boolean;
	flush(): Promise<void>;
	flushSync(): void;
	end(): Promise<void>;
	_destination?: unknown;
}

export interface PiiRedactionRules {
	patterns: RegExp[];
	customPaths: string[];
	emailRedaction: boolean;
	userIdRedaction: boolean;
}

export interface CorrelationContext {
	id: string;
	metadata?: Record<string, unknown>;
}

export interface PerformanceMetrics {
	startTime: number;
	duration?: number;
	memoryUsage?: NodeJS.MemoryUsage;
	cpuUsage?: NodeJS.CpuUsage;
}

export interface TransportConfig {
	target: string;
	options: {
		destination?: string;
		level?: LogLevel;
		formatters?: Record<string, (data: unknown) => unknown>;
		redact?: string[];
		frequency?: string | number;
		size?: string | number;
		limit?: {
			count: number;
			removeOtherLogFiles?: boolean;
		};
		dateFormat?: string;
		extension?: string;
		symlink?: boolean;
		mkdir?: boolean;
		compress?: boolean;
		sync?: boolean;
		minLength?: number;
		maxLength?: number;
		periodicFlush?: number;
	};
}

/**
 * Environment-specific transport configuration
 */
export interface EnvironmentTransportConfig {
	enableFile: boolean;
	enableConsole: boolean;
}

/**
 * Pino transport options type
 */
export interface PinoTransportOptions {
	target: string;
	options?: {
		destination?: string;
		mkdir?: boolean;
		append?: boolean;
		[key: string]: unknown;
	};
}
