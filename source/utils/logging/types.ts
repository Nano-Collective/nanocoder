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

export type LogLevelNumber = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface LoggerConfig {
	level: LogLevel;
	destination?: string;
	pretty: boolean;
	redact: string[];
	correlation: boolean;
	serialize: boolean;
	transport?: unknown;
}

export interface LogEntry {
	level: LogLevel;
	time: string;
	pid: number;
	hostname: string;
	correlationId?: string;
	nodeVersion?: string; // NEW: Node.js version field
	platform?: string; // NEW: platform field
	arch?: string; // NEW: architecture field
	service?: string; // NEW: service field
	version?: string; // NEW: version field
	environment?: string; // NEW: environment field
	msg: string;
	[key: string]: unknown;
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

// Error handling
export interface SerializedError {
	name?: string;
	message: string;
	stack?: string;
	code?: string | number;
	statusCode?: number;
	status?: number;
	[key: string]: unknown;
}

// Performance tracking types
export interface PerformanceData {
	functionName: string;
	duration: string;
	durationMs: number;
	correlationId: string;
	source: string;
	memoryDelta?: Record<string, number>;
	memoryDeltaFormatted?: Record<string, string>;
	currentMemory?: Record<string, string>;
	cpuPercent?: string;
	cpuUsageRaw?: number;
	argCount?: number;
	argTypes?: string[];
	thresholdWarnings?: string[];
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
	end(): Promise<void>;
}

export interface PiiRedactionRules {
	patterns: RegExp[];
	customPaths: string[];
	emailRedaction: boolean;
	userIdRedaction: boolean;
}

export interface CorrelationContext {
	id: string;
	parentId?: string;
	metadata?: Record<string, unknown>;
}

export interface CorrelationMetadata {
	source?: string;
	version?: string;
	environment?: string;
	requestId?: string;
	[key: string]: unknown;
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
 * CLI configuration for logging control
 */
export interface LoggingCliConfig {
	logToFile?: boolean;
	logToConsole?: boolean;
	noLogFile?: boolean;
	noLogConsole?: boolean;
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

/**
 * Type for console method arguments
 */
export type ConsoleArgument =
	| string
	| number
	| boolean
	| null
	| undefined
	| Error
	| Record<string, unknown>
	| Array<unknown>;

/**
 * Type for console method arguments array
 */
export type ConsoleArguments = ConsoleArgument[];

/**
 * Typed object for console log data
 */
export interface ConsoleLogData extends Record<string, unknown> {
	correlationId: string;
	source: string;
	argumentCount?: number;
	stringArgs?: number;
	objectArgs?: number;
	primitiveArgs?: number;
	objects?: unknown[];
	errorLikeObjects?: unknown[];
	moduleName?: string;
	allArgs?: ConsoleArguments;
}

/**
 * Type for HTTP request object in correlation tracking
 */
export interface CorrelationHttpRequest {
	method?: string;
	url?: string;
	headers?: Record<string, string>;
}

/**
 * Type for HTTP response object in correlation tracking
 */
export interface CorrelationHttpResponse {
	statusCode?: number;
	headers?: Record<string, string>;
	setHeader?: (name: string, value: string) => void;
}
