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
	transport?: any;
}

export interface LogEntry {
	level: LogLevel;
	time: string;
	pid: number;
	hostname: string;
	correlationId?: string;
	msg: string;
	[key: string]: any;
}

export interface Logger {
	fatal: ((msg: string, ...args: any[]) => void) & ((obj: object, msg?: string) => void);
	error: ((msg: string, ...args: any[]) => void) & ((obj: object, msg?: string) => void);
	warn: ((msg: string, ...args: any[]) => void) & ((obj: object, msg?: string) => void);
	info: ((msg: string, ...args: any[]) => void) & ((obj: object, msg?: string) => void);
	http: ((msg: string, ...args: any[]) => void) & ((obj: object, msg?: string) => void);
	debug: ((msg: string, ...args: any[]) => void) & ((obj: object, msg?: string) => void);
	trace: ((msg: string, ...args: any[]) => void) & ((obj: object, msg?: string) => void);

	child(bindings: Record<string, any>): Logger;
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
	metadata?: Record<string, any>;
}

export interface CorrelationMetadata {
	source?: string;
	version?: string;
	environment?: string;
	requestId?: string;
	[key: string]: any;
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
		formatters?: any;
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
