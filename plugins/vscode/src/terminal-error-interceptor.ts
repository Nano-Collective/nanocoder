import * as vscode from 'vscode';

interface ErrorPattern {
	regex: RegExp;
	description: string;
}

// Common error patterns across different tools and languages
export const ERROR_PATTERNS: ErrorPattern[] = [
	// TypeScript/JavaScript errors
	{regex: /error TS\d+:/i, description: 'TypeScript compilation error'},
	{regex: /SyntaxError:/i, description: 'JavaScript syntax error'},
	{regex: /TypeError:/i, description: 'JavaScript type error'},
	{regex: /ReferenceError:/i, description: 'JavaScript reference error'},

	// Build tool errors
	{regex: /ERROR in /i, description: 'Build error'},
	{regex: /Build failed/i, description: 'Build failure'},
	{regex: /\[ERROR\]/i, description: 'Build system error'},

	// Test failures
	{regex: /FAIL /i, description: 'Test failure'},
	{regex: /\d+ failing/i, description: 'Test failures detected'},
	{regex: /Test suite failed/i, description: 'Test suite failure'},

	// Linting errors
	{regex: /✖ \d+ problems?/i, description: 'Lint errors'},
	{regex: /error\s+.+\s+eslint/i, description: 'ESLint error'},

	// Generic error indicators
	{regex: /Error:/i, description: 'Error detected'},
	{regex: /Exception:/i, description: 'Exception thrown'},
	{regex: /ENOENT:/i, description: 'File or directory not found'},
	{regex: /command not found/i, description: 'Command not found'},
];

interface TerminalOutput {
	terminal: vscode.Terminal;
	outputBuffer: string[];
	hasError: boolean;
	lastErrorContext: string[];
	resetTimer?: NodeJS.Timeout;
}

export class TerminalErrorInterceptor implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	private readonly terminalOutputs = new Map<vscode.Terminal, TerminalOutput>();
	private readonly outputChannel: vscode.OutputChannel;
	private readonly onFixRequestedCallback: (errorContext: string) => void;

	constructor(
		outputChannel: vscode.OutputChannel,
		onFixRequested: (errorContext: string) => void,
	) {
		this.outputChannel = outputChannel;
		this.onFixRequestedCallback = onFixRequested;

		// Listen to terminal lifecycle events
		this.disposables.push(
			vscode.window.onDidOpenTerminal(terminal => {
				this.registerTerminal(terminal);
			}),
			vscode.window.onDidCloseTerminal(terminal => {
				this.terminalOutputs.delete(terminal);
			}),
		);

		// Register existing terminals
		vscode.window.terminals.forEach(terminal => {
			this.registerTerminal(terminal);
		});

		// Listen to terminal output
		// Note: onDidWriteTerminalData requires VS Code 1.93+
		// For older versions, we fall back to manual polling via the command
		const windowWithTerminalData = vscode.window as typeof vscode.window & {
			onDidWriteTerminalData?: (
				listener: (event: {terminal: vscode.Terminal; data: string}) => void,
			) => vscode.Disposable;
		};

		if (windowWithTerminalData.onDidWriteTerminalData) {
			this.disposables.push(
				windowWithTerminalData.onDidWriteTerminalData(event => {
					this.handleTerminalData(event.terminal, event.data);
				}),
			);
		} else {
			// Fallback: For older VS Code versions, rely on user diagnostics
			// and manual trigger via the fixTerminalError command
			this.outputChannel.appendLine(
				'[Terminal Error Interceptor] Terminal data monitoring not available. Use "Fix Terminal Error with AI" command manually.',
			);
		}
	}

	private registerTerminal(terminal: vscode.Terminal): void {
		if (!this.terminalOutputs.has(terminal)) {
			this.terminalOutputs.set(terminal, {
				terminal,
				outputBuffer: [],
				hasError: false,
				lastErrorContext: [],
			});
		}
	}

	private handleTerminalData(terminal: vscode.Terminal, data: string): void {
		const terminalOutput = this.terminalOutputs.get(terminal);
		if (!terminalOutput) {
			return;
		}

		// Add data to buffer (keep last 100 lines)
		const lines = data.split('\n');
		terminalOutput.outputBuffer.push(...lines);
		if (terminalOutput.outputBuffer.length > 100) {
			terminalOutput.outputBuffer = terminalOutput.outputBuffer.slice(-100);
		}

		// Check for errors
		const hasError = this.detectError(data);
		if (hasError && !terminalOutput.hasError) {
			terminalOutput.hasError = true;
			terminalOutput.lastErrorContext = this.extractErrorContext(
				terminalOutput.outputBuffer,
			);
			this.showFixAction(terminal, terminalOutput.lastErrorContext);
		}

		// Reset error flag after some time (to allow for repeated detections)
		// Clear any existing timer first to avoid overlapping resets
		if (hasError) {
			if (terminalOutput.resetTimer) {
				clearTimeout(terminalOutput.resetTimer);
			}
			terminalOutput.resetTimer = setTimeout(() => {
				terminalOutput.hasError = false;
				terminalOutput.resetTimer = undefined;
			}, 2000);
		}
	}

	private detectError(data: string): boolean {
		return ERROR_PATTERNS.some(pattern => pattern.regex.test(data));
	}

	private extractErrorContext(buffer: string[]): string[] {
		// Extract the last 30 lines that contain meaningful error information
		const contextLines: string[] = [];
		let foundError = false;

		// Work backwards from the end to find the error and surrounding context
		for (let i = buffer.length - 1; i >= 0 && contextLines.length < 30; i--) {
			const line = buffer[i]?.trim();
			if (!line) continue;

			// Include lines that contain error information
			if (
				this.detectError(line) ||
				foundError ||
				line.includes('at ') || // Stack traces
				line.includes('→') || // Build output
				line.includes('✖') || // Lint errors
				line.match(/^\s*\d+\s*\|/) || // Source code lines with numbers
				line.includes('expected') ||
				line.includes('received')
			) {
				contextLines.unshift(line);
				if (this.detectError(line)) {
					foundError = true;
				}
			}
		}

		return contextLines.length > 0 ? contextLines : buffer.slice(-20);
	}

	private showFixAction(
		terminal: vscode.Terminal,
		errorContext: string[],
	): void {
		const errorText = errorContext.join('\n');

		// Show notification with action button
		vscode.window
			.showErrorMessage(
				'Terminal error detected. Would you like Nanocoder to help fix it?',
				'Fix with AI',
				'Dismiss',
			)
			.then(selection => {
				if (selection === 'Fix with AI') {
					this.onFixRequestedCallback(errorText);
					this.outputChannel.appendLine(
						'[Terminal Error Interceptor] User requested AI fix for terminal error',
					);
				}
			});
	}

	/**
	 * Get the last error context from a specific terminal, if any.
	 * Used by the manual fix command to access captured errors.
	 */
	public getLastErrorContext(terminal: vscode.Terminal): string[] | undefined {
		const terminalOutput = this.terminalOutputs.get(terminal);
		return terminalOutput?.lastErrorContext.length
			? terminalOutput.lastErrorContext
			: undefined;
	}

	public dispose(): void {
		// Clear all pending timers
		for (const terminalOutput of this.terminalOutputs.values()) {
			if (terminalOutput.resetTimer) {
				clearTimeout(terminalOutput.resetTimer);
			}
		}
		this.disposables.forEach(d => d.dispose());
		this.terminalOutputs.clear();
	}
}
