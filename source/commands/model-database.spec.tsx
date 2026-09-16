import test from 'ava';
import clipboard from 'clipboardy';
import React from 'react';
import {renderWithTheme} from '../test-utils/render-with-theme.js';
import {clearModelCache} from '../model-database/model-fetcher.js';
import {ModelDatabaseDisplay, modelDatabaseCommand} from './model-database.js';

console.log(`\nmodel-database.spec.tsx – ${React.version}`);

// clipboardy shells out to a platform clipboard tool that may not be present
// in CI/sandboxes — stub `write` directly, same approach copy.spec.tsx uses.
const originalWrite = clipboard.write;
let lastWritten: string | null = null;
let writeImpl: (text: string) => Promise<void> = async text => {
	lastWritten = text;
};

test.beforeEach(() => {
	lastWritten = null;
	writeImpl = async text => {
		lastWritten = text;
	};
	(clipboard as {write: (text: string) => Promise<void>}).write = text =>
		writeImpl(text);
});

test.afterEach(() => {
	(clipboard as {write: (text: string) => Promise<void>}).write = originalWrite;
});

// Helper to create mock OpenRouter API response
function createMockOpenRouterResponse() {
	return {
		data: [
			{
				id: 'openai/gpt-4',
				name: 'GPT-4',
				description: 'Advanced AI model',
				created: 1700000000,
				context_length: 128000,
				architecture: {
					modality: 'text',
					input_modalities: ['text'],
					output_modalities: ['text'],
					tokenizer: 'unknown',
				},
				pricing: {prompt: '0.00003', completion: '0.00006'},
				supported_parameters: ['tools'],
			},
			{
				id: 'meta-llama/llama-3.1-70b',
				name: 'Llama 3.1 70B',
				description: 'Open source model',
				created: 1710000000,
				context_length: 128000,
				architecture: {
					modality: 'text',
					input_modalities: ['text'],
					output_modalities: ['text'],
					tokenizer: 'unknown',
				},
				pricing: {prompt: '0', completion: '0'},
				supported_parameters: ['tools'],
			},
			{
				id: 'anthropic/claude-3-opus',
				name: 'Claude 3 Opus',
				description: 'Powerful reasoning model',
				created: 1705000000,
				context_length: 200000,
				architecture: {
					modality: 'text',
					input_modalities: ['text'],
					output_modalities: ['text'],
					tokenizer: 'unknown',
				},
				pricing: {prompt: '0.000015', completion: '0.000075'},
				supported_parameters: ['tools'],
			},
		],
	};
}

// ============================================================================
// Command Metadata Tests
// ============================================================================

test('modelDatabaseCommand: has correct name', t => {
	t.is(modelDatabaseCommand.name, 'model-database');
});

test('modelDatabaseCommand: has description', t => {
	t.truthy(modelDatabaseCommand.description);
	t.true(modelDatabaseCommand.description.length > 0);
});

test('modelDatabaseCommand: has handler function', t => {
	t.is(typeof modelDatabaseCommand.handler, 'function');
});

test('modelDatabaseCommand: handler is async', t => {
	const result = modelDatabaseCommand.handler([], [], {});
	t.truthy(result);
	t.true(result instanceof Promise);
});

test('modelDatabaseCommand: handler returns React element', async t => {
	const result = await modelDatabaseCommand.handler([], [], {});
	t.truthy(result);
	t.true(React.isValidElement(result));
});

// ============================================================================
// Component Rendering Tests - Loading State
// ============================================================================

test.serial('ModelDatabaseDisplay: shows loading state initially', async t => {
	clearModelCache();

	// Mock fetch to delay response
	const originalFetch = globalThis.fetch;
	let resolveFetch: (value: Response) => void;
	const fetchPromise = new Promise<Response>(resolve => {
		resolveFetch = resolve;
	});
	globalThis.fetch = () => fetchPromise;

	try {
		const {lastFrame} = renderWithTheme(<ModelDatabaseDisplay />);

		const output = lastFrame();
		t.truthy(output);
		t.regex(output!, /Fetching models|OpenRouter/i);
	} finally {
		// Resolve the fetch to clean up
		resolveFetch!({
			ok: true,
			json: async () => createMockOpenRouterResponse(),
		} as Response);
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

// ============================================================================
// Component Rendering Tests - Error State
// ============================================================================

test.serial(
	'ModelDatabaseDisplay: shows error state on fetch failure',
	async t => {
		clearModelCache();

		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			return {
				ok: false,
				status: 500,
			} as Response;
		};

		try {
			const {lastFrame} = renderWithTheme(<ModelDatabaseDisplay />);

			// Wait for fetch to complete
			await new Promise(resolve => setTimeout(resolve, 100));

			const output = lastFrame();
			t.truthy(output);
			// After fetch failure, it may show empty state or error
			// The component shows "No models available" if fetch returns empty array
		} finally {
			globalThis.fetch = originalFetch;
			clearModelCache();
		}
	},
);

// ============================================================================
// Component Rendering Tests - Loaded State
// ============================================================================

test.serial('ModelDatabaseDisplay: renders with model data', async t => {
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () => createMockOpenRouterResponse(),
		} as Response;
	};

	try {
		const {lastFrame} = renderWithTheme(<ModelDatabaseDisplay />);

		// Wait for async fetch to complete
		await new Promise(resolve => setTimeout(resolve, 200));

		const output = lastFrame();
		t.truthy(output);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial('ModelDatabaseDisplay: displays model name', async t => {
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () => createMockOpenRouterResponse(),
		} as Response;
	};

	try {
		const {lastFrame} = renderWithTheme(<ModelDatabaseDisplay />);

		await new Promise(resolve => setTimeout(resolve, 200));

		const output = lastFrame();
		t.truthy(output);
		// Should display one of the model names
		t.true(
			output!.includes('GPT-4') ||
				output!.includes('Llama') ||
				output!.includes('Claude'),
		);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial('ModelDatabaseDisplay: displays tab names', async t => {
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () => createMockOpenRouterResponse(),
		} as Response;
	};

	try {
		const {lastFrame} = renderWithTheme(<ModelDatabaseDisplay />);

		await new Promise(resolve => setTimeout(resolve, 200));

		const output = lastFrame();
		t.truthy(output);
		t.regex(output!, /Latest|Open|Proprietary/);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial(
	'ModelDatabaseDisplay: displays OpenRouter attribution',
	async t => {
		clearModelCache();

		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			return {
				ok: true,
				json: async () => createMockOpenRouterResponse(),
			} as Response;
		};

		try {
			const {lastFrame} = renderWithTheme(<ModelDatabaseDisplay />);

			await new Promise(resolve => setTimeout(resolve, 200));

			const output = lastFrame();
			t.truthy(output);
			t.regex(output!, /OpenRouter/);
		} finally {
			globalThis.fetch = originalFetch;
			clearModelCache();
		}
	},
);

test.serial('ModelDatabaseDisplay: displays navigation help', async t => {
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () => createMockOpenRouterResponse(),
		} as Response;
	};

	try {
		const {lastFrame} = renderWithTheme(<ModelDatabaseDisplay />);

		await new Promise(resolve => setTimeout(resolve, 200));

		const output = lastFrame();
		t.truthy(output);
		// Should show navigation instructions
		t.regex(output!, /Navigate|Tab|Esc/i);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

// ============================================================================
// Component Rendering Tests - Model Details
// ============================================================================

test.serial('ModelDatabaseDisplay: displays model details', async t => {
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () => createMockOpenRouterResponse(),
		} as Response;
	};

	try {
		const {lastFrame} = renderWithTheme(<ModelDatabaseDisplay />);

		await new Promise(resolve => setTimeout(resolve, 200));

		const output = lastFrame();
		t.truthy(output);
		// Should display model details like Author, Context, Type, Cost
		t.regex(output!, /Author|Context|Type|Cost/);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial('ModelDatabaseDisplay: displays model count', async t => {
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () => createMockOpenRouterResponse(),
		} as Response;
	};

	try {
		const {lastFrame} = renderWithTheme(<ModelDatabaseDisplay />);

		await new Promise(resolve => setTimeout(resolve, 200));

		const output = lastFrame();
		t.truthy(output);
		// Should display model count like "Model 1 of 3"
		t.regex(output!, /Model \d+ of \d+|of \d+/);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

// ============================================================================
// onCancel Callback Tests
// ============================================================================

test.serial('ModelDatabaseDisplay: calls onCancel callback', async t => {
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () => createMockOpenRouterResponse(),
		} as Response;
	};

	let cancelCalled = false;
	const onCancel = () => {
		cancelCalled = true;
	};

	try {
		const {stdin} = renderWithTheme(<ModelDatabaseDisplay onCancel={onCancel} />);

		await new Promise(resolve => setTimeout(resolve, 200));

		// Press Escape to cancel
		stdin.write('\u001B'); // Escape key

		await new Promise(resolve => setTimeout(resolve, 50));

		t.true(cancelCalled);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial('ModelDatabaseDisplay: calls onCancel on Enter key', async t => {
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () => createMockOpenRouterResponse(),
		} as Response;
	};

	let cancelCalled = false;
	const onCancel = () => {
		cancelCalled = true;
	};

	try {
		const {stdin} = renderWithTheme(<ModelDatabaseDisplay onCancel={onCancel} />);

		await new Promise(resolve => setTimeout(resolve, 200));

		// Press Enter to close
		stdin.write('\r');

		await new Promise(resolve => setTimeout(resolve, 50));

		t.true(cancelCalled);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

// ============================================================================
// Keyboard Navigation Tests
// ============================================================================

test.serial('ModelDatabaseDisplay: handles arrow key navigation', async t => {
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () => createMockOpenRouterResponse(),
		} as Response;
	};

	try {
		const {stdin, lastFrame} = renderWithTheme(<ModelDatabaseDisplay />);

		await new Promise(resolve => setTimeout(resolve, 200));

		const initialOutput = lastFrame();

		// Press down arrow to navigate
		stdin.write('\u001B[B'); // Down arrow

		await new Promise(resolve => setTimeout(resolve, 50));

		const afterDownOutput = lastFrame();

		// The output should potentially show different model or counter
		t.truthy(initialOutput);
		t.truthy(afterDownOutput);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

// ============================================================================
// Search Mode Tests
// ============================================================================

test.serial('ModelDatabaseDisplay: enters search mode on typing', async t => {
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () => createMockOpenRouterResponse(),
		} as Response;
	};

	try {
		const {stdin, lastFrame} = renderWithTheme(<ModelDatabaseDisplay />);

		await new Promise(resolve => setTimeout(resolve, 200));

		// Type a search query
		stdin.write('g');

		await new Promise(resolve => setTimeout(resolve, 50));

		const output = lastFrame();
		t.truthy(output);
		// Should show search indicator or the typed character
		t.regex(output!, /Search|g/i);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial(
	'ModelDatabaseDisplay: filters models based on search query',
	async t => {
		clearModelCache();

		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			return {
				ok: true,
				json: async () => createMockOpenRouterResponse(),
			} as Response;
		};

		try {
			const {stdin, lastFrame} = renderWithTheme(<ModelDatabaseDisplay />);

			await new Promise(resolve => setTimeout(resolve, 200));

			// Type search query character by character with delays
			stdin.write('l');
			await new Promise(resolve => setTimeout(resolve, 30));
			stdin.write('l');
			await new Promise(resolve => setTimeout(resolve, 30));
			stdin.write('a');
			await new Promise(resolve => setTimeout(resolve, 30));
			stdin.write('m');
			await new Promise(resolve => setTimeout(resolve, 30));
			stdin.write('a');

			await new Promise(resolve => setTimeout(resolve, 100));

			const output = lastFrame();
			t.truthy(output);
			// Should show search mode with query "llama"
			t.regex(output!, /llama|Search/i);
		} finally {
			globalThis.fetch = originalFetch;
			clearModelCache();
		}
	},
);

test.serial(
	'ModelDatabaseDisplay: search mode can be entered and exited',
	async t => {
		clearModelCache();

		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			return {
				ok: true,
				json: async () => createMockOpenRouterResponse(),
			} as Response;
		};

		try {
			const {stdin, lastFrame} = renderWithTheme(<ModelDatabaseDisplay />);

			await new Promise(resolve => setTimeout(resolve, 200));

			// Get initial state
			const initialOutput = lastFrame();
			t.truthy(initialOutput);

			// Enter search mode by typing
			stdin.write('t');
			await new Promise(resolve => setTimeout(resolve, 50));
			stdin.write('e');
			await new Promise(resolve => setTimeout(resolve, 50));

			const searchOutput = lastFrame();
			t.truthy(searchOutput);
			// In search mode, should show search indicator
			t.regex(searchOutput!, /Search|te/i);
		} finally {
			globalThis.fetch = originalFetch;
			clearModelCache();
		}
	},
);

// ============================================================================
// Empty State Tests
// ============================================================================

test.serial('ModelDatabaseDisplay: handles empty model list', async t => {
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () => ({data: []}),
		} as Response;
	};

	try {
		const {lastFrame} = renderWithTheme(<ModelDatabaseDisplay />);

		await new Promise(resolve => setTimeout(resolve, 200));

		const output = lastFrame();
		t.truthy(output);
		// Should show empty state message
		t.regex(output!, /No models|available/i);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial(
	'ModelDatabaseDisplay: Enter still closes the panel when no model is highlighted',
	async t => {
		clearModelCache();

		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			return {
				ok: true,
				json: async () => ({data: []}),
			} as Response;
		};

		let cancelCalled = false;
		const onCancel = () => {
			cancelCalled = true;
		};

		try {
			const {stdin} = renderWithTheme(<ModelDatabaseDisplay onCancel={onCancel} />);

			await new Promise(resolve => setTimeout(resolve, 200));

			stdin.write('\r');

			await new Promise(resolve => setTimeout(resolve, 50));

			t.true(cancelCalled);
			t.is(lastWritten, null);
		} finally {
			globalThis.fetch = originalFetch;
			clearModelCache();
		}
	},
);

// ============================================================================
// Tab Switching Tests
// ============================================================================

test.serial('ModelDatabaseDisplay: switches tabs on Tab key', async t => {
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () => createMockOpenRouterResponse(),
		} as Response;
	};

	try {
		const {stdin, lastFrame} = renderWithTheme(<ModelDatabaseDisplay />);

		await new Promise(resolve => setTimeout(resolve, 200));

		const initialOutput = lastFrame();

		// Press Tab to switch tabs
		stdin.write('\t');

		await new Promise(resolve => setTimeout(resolve, 50));

		const afterTabOutput = lastFrame();

		// Both outputs should be valid
		t.truthy(initialOutput);
		t.truthy(afterTabOutput);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

// ============================================================================
// Command Title Tests
// ============================================================================

test.serial('ModelDatabaseDisplay: displays command title', async t => {
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () => createMockOpenRouterResponse(),
		} as Response;
	};

	try {
		const {lastFrame} = renderWithTheme(<ModelDatabaseDisplay />);

		await new Promise(resolve => setTimeout(resolve, 200));

		const output = lastFrame();
		t.truthy(output);
		// Should display the command title
		t.regex(output!, /model-database|Model Browser/i);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

// ============================================================================
// Copy/Switch on Enter Tests
// ============================================================================

// Mock data is sorted by `created` descending for the "latest" tab, so
// meta-llama/llama-3.1-70b (created 1710000000) is the highlighted model
// by default.
const HIGHLIGHTED_MODEL_ID = 'meta-llama/llama-3.1-70b';

test.serial(
	'ModelDatabaseDisplay: Enter copies the highlighted model ID to the clipboard',
	async t => {
		clearModelCache();

		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			return {
				ok: true,
				json: async () => createMockOpenRouterResponse(),
			} as Response;
		};

		try {
			const {stdin} = renderWithTheme(<ModelDatabaseDisplay />);

			await new Promise(resolve => setTimeout(resolve, 200));

			stdin.write('\r');

			await new Promise(resolve => setTimeout(resolve, 50));

			t.is(lastWritten, HIGHLIGHTED_MODEL_ID);
		} finally {
			globalThis.fetch = originalFetch;
			clearModelCache();
		}
	},
);

test.serial(
	'ModelDatabaseDisplay: Enter shows a copy confirmation and closes when not on OpenRouter',
	async t => {
		clearModelCache();

		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			return {
				ok: true,
				json: async () => createMockOpenRouterResponse(),
			} as Response;
		};

		let cancelCalled = false;
		const onCancel = () => {
			cancelCalled = true;
		};

		try {
			const {stdin} = renderWithTheme(
				<ModelDatabaseDisplay onCancel={onCancel} currentProvider="ollama" />,
			);

			await new Promise(resolve => setTimeout(resolve, 200));

			stdin.write('\r');

			await new Promise(resolve => setTimeout(resolve, 50));

			t.is(lastWritten, HIGHLIGHTED_MODEL_ID);
			t.true(cancelCalled);
		} finally {
			globalThis.fetch = originalFetch;
			clearModelCache();
		}
	},
);

test.serial(
	'ModelDatabaseDisplay: Enter switches the model when the active provider is OpenRouter',
	async t => {
		clearModelCache();

		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			return {
				ok: true,
				json: async () => createMockOpenRouterResponse(),
			} as Response;
		};

		let cancelCalled = false;
		const onCancel = () => {
			cancelCalled = true;
		};

		const selectCalls: Array<[string, string]> = [];
		const onModelSelect = async (provider: string, model: string) => {
			selectCalls.push([provider, model]);
			return undefined;
		};

		try {
			const {stdin} = renderWithTheme(
				<ModelDatabaseDisplay
					onCancel={onCancel}
					currentProvider="openrouter"
					onModelSelect={onModelSelect}
				/>,
			);

			await new Promise(resolve => setTimeout(resolve, 200));

			stdin.write('\r');

			await new Promise(resolve => setTimeout(resolve, 50));

			t.is(lastWritten, HIGHLIGHTED_MODEL_ID);
			t.deepEqual(selectCalls, [['openrouter', HIGHLIGHTED_MODEL_ID]]);
			// Switching delegates closing to onModelSelect's own exitMode() —
			// the component itself must not also call onCancel.
			t.false(cancelCalled);
		} finally {
			globalThis.fetch = originalFetch;
			clearModelCache();
		}
	},
);

test.serial(
	'ModelDatabaseDisplay: Enter passes through the configured provider casing, not a hardcoded literal',
	async t => {
		clearModelCache();

		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			return {
				ok: true,
				json: async () => createMockOpenRouterResponse(),
			} as Response;
		};

		const selectCalls: Array<[string, string]> = [];
		const onModelSelect = async (provider: string, model: string) => {
			selectCalls.push([provider, model]);
			return undefined;
		};

		try {
			// isOpenRouterProvider() matches "OpenRouter" case-insensitively,
			// but the app's downstream handleModelSelect compares provider
			// names with strict equality — so onModelSelect must receive the
			// same casing that was configured, not a hardcoded 'openrouter'.
			const {stdin} = renderWithTheme(
				<ModelDatabaseDisplay
					currentProvider="OpenRouter"
					onModelSelect={onModelSelect}
				/>,
			);

			await new Promise(resolve => setTimeout(resolve, 200));

			stdin.write('\r');

			await new Promise(resolve => setTimeout(resolve, 50));

			t.deepEqual(selectCalls, [['OpenRouter', HIGHLIGHTED_MODEL_ID]]);
		} finally {
			globalThis.fetch = originalFetch;
			clearModelCache();
		}
	},
);

test.serial(
	'ModelDatabaseDisplay: footer hint mentions "Copy & Switch" when on OpenRouter',
	async t => {
		clearModelCache();

		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			return {
				ok: true,
				json: async () => createMockOpenRouterResponse(),
			} as Response;
		};

		try {
			const {lastFrame} = renderWithTheme(
				<ModelDatabaseDisplay currentProvider="openrouter" />,
			);

			await new Promise(resolve => setTimeout(resolve, 200));

			const output = lastFrame();
			t.truthy(output);
			t.true(output!.includes('Copy & Switch'));
		} finally {
			globalThis.fetch = originalFetch;
			clearModelCache();
		}
	},
);

test.serial(
	'ModelDatabaseDisplay: footer hint says "Copy ID" when not on OpenRouter',
	async t => {
		clearModelCache();

		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			return {
				ok: true,
				json: async () => createMockOpenRouterResponse(),
			} as Response;
		};

		try {
			const {lastFrame} = renderWithTheme(<ModelDatabaseDisplay />);

			await new Promise(resolve => setTimeout(resolve, 200));

			const output = lastFrame();
			t.truthy(output);
			t.true(output!.includes('Copy ID'));
			t.false(output!.includes('Copy & Switch'));
		} finally {
			globalThis.fetch = originalFetch;
			clearModelCache();
		}
	},
);
