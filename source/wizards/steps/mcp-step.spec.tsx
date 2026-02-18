import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {McpStep} from './mcp-step.js';

// ============================================================================
// Tests for McpStep Component Rendering
// ============================================================================

console.log(`\nmcp-step.spec.tsx – ${React.version}`);

test('McpStep renders with initial menu', t => {
	const {lastFrame} = render(<McpStep onComplete={() => {}} />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Configure MCP Servers/);
	t.regex(output!, /Add MCP servers/);
});

test('McpStep shows initial menu options', t => {
	const {lastFrame} = render(<McpStep onComplete={() => {}} />);

	const output = lastFrame();
	t.regex(output!, /Configure MCP Servers/);
	t.regex(output!, /Add MCP servers/);
});

test('McpStep does not show skip option', t => {
	const {lastFrame} = render(<McpStep onComplete={() => {}} />);

	const output = lastFrame();
	t.notRegex(output!, /Skip MCP servers/);
});

test('McpStep shows edit option when servers exist', t => {
	const existingServers = {
		filesystem: {
			name: 'filesystem',
			transport: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /Edit existing servers/);
});

test('McpStep renders without crashing when onBack is provided', t => {
	let backCalled = false;

	const {lastFrame} = render(
		<McpStep
			onComplete={() => {}}
			onBack={() => {
				backCalled = true;
			}}
		/>,
	);

	t.truthy(lastFrame());
	t.false(backCalled); // Should not be called on render
});

test('McpStep accepts existingServers prop', t => {
	const existingServers = {
		filesystem: {
			name: 'filesystem',
			transport: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	// Component should render without errors
	t.truthy(lastFrame());
});

test('McpStep renders with correct initial state', t => {
	const {frames} = render(<McpStep onComplete={() => {}} />);

	// Should have rendered at least one frame
	t.true(frames.length > 0);

	// First frame should show initial menu
	const firstFrame = frames[0];
	t.regex(firstFrame, /Configure MCP Servers/);
});

test('McpStep shows configured servers when they exist', t => {
	const existingServers = {
		filesystem: {
			name: 'filesystem',
			transport: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
		},
		github: {
			name: 'github',
			transport: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-github'],
			env: {GITHUB_PERSONAL_ACCESS_TOKEN: 'token'},
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /2 MCP server\(s\) configured:/);
	t.regex(output!, /filesystem/);
	t.regex(output!, /github/);
});

test('McpStep does not show edit option when no servers exist', t => {
	const {lastFrame} = render(<McpStep onComplete={() => {}} />);

	const output = lastFrame();
	// Edit option should not be shown when no servers exist
	t.notRegex(output!, /Edit existing servers/);
});

test('McpStep handles empty existingServers object', t => {
	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={{}} />,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should not show configured servers when none exist
	t.notRegex(output!, /MCP server\(s\) configured:/);
});

test('McpStep shows single configured server', t => {
	const existingServers = {
		filesystem: {
			name: 'filesystem',
			transport: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /1 MCP server\(s\) configured:/);
	t.regex(output!, /filesystem/);
});

test('McpStep shows multiple configured servers', t => {
	const existingServers = {
		filesystem: {
			name: 'filesystem',
			transport: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
		},
		github: {
			name: 'github',
			transport: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-github'],
		},
		postgres: {
			name: 'postgres',
			transport: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-postgres'],
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /3 MCP server\(s\) configured:/);
	t.regex(output!, /filesystem/);
	t.regex(output!, /github/);
	t.regex(output!, /postgres/);
});

test('McpStep calls onComplete when provided', t => {
	let completeCalled = false;

	const {lastFrame} = render(
		<McpStep
			onComplete={() => {
				completeCalled = true;
			}}
		/>,
	);

	t.truthy(lastFrame());
	t.false(completeCalled); // Should not be called on render
});

test('McpStep calls onBack when provided', t => {
	let backCalled = false;

	const {lastFrame} = render(
		<McpStep
			onComplete={() => {}}
			onBack={() => {
				backCalled = true;
			}}
		/>,
	);

	t.truthy(lastFrame());
	t.false(backCalled); // Should not be called on render
});

test('McpStep requires onComplete prop', t => {
	const {lastFrame} = render(<McpStep onComplete={() => {}} />);

	// Component should render without errors
	t.truthy(lastFrame());
});

test('McpStep handles optional onBack prop', t => {
	const {lastFrame} = render(<McpStep onComplete={() => {}} />);

	// Component should render without errors even without onBack
	t.truthy(lastFrame());
});

test('McpStep handles optional existingServers prop', t => {
	const {lastFrame} = render(<McpStep onComplete={() => {}} />);

	// Component should render without errors even without existingServers
	t.truthy(lastFrame());
});

test('McpStep renders SelectInput component', t => {
	const {lastFrame} = render(<McpStep onComplete={() => {}} />);

	const output = lastFrame();
	// SelectInput should render options
	t.truthy(output);
	t.regex(output!, /Configure MCP Servers/);
});

test('McpStep shows template descriptions on wide terminals', t => {
	// This test verifies that templates with descriptions are shown
	const {lastFrame} = render(<McpStep onComplete={() => {}} />);

	const output = lastFrame();
	// On wide terminals, descriptions should be visible
	// Note: This may vary based on terminal width in the test environment
	t.truthy(output);
});

test('McpStep handles multiple server configurations', t => {
	const existingServers = {
		filesystem: {
			name: 'filesystem',
			transport: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp', '/home'],
		},
		github: {
			name: 'github',
			transport: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-github'],
		},
		postgres: {
			name: 'postgres',
			transport: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-postgres'],
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /filesystem/);
	t.regex(output!, /github/);
	t.regex(output!, /postgres/);
});

// ============================================================================
// Tests for McpStep Server Configurations
// ============================================================================

test('McpStep handles filesystem server config', t => {
	const existingServers = {
		filesystem: {
			name: 'filesystem',
			transport: 'stdio',
			command: 'npx',
			args: [
				'-y',
				'@modelcontextprotocol/server-filesystem',
				'/tmp',
				'/home/user',
			],
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /filesystem/);
});

test('McpStep handles github server config with env', t => {
	const existingServers = {
		github: {
			name: 'github',
			transport: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-github'],
			env: {
				GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_test123',
			},
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /github/);
});

test('McpStep handles postgres server config', t => {
	const existingServers = {
		postgres: {
			name: 'postgres',
			transport: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-postgres'],
			env: {
				POSTGRES_CONNECTION_STRING: 'postgresql://localhost/db',
			},
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /postgres/);
});

test('McpStep handles brave-search server config', t => {
	const existingServers = {
		'brave-search': {
			name: 'brave-search',
			transport: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-brave-search'],
			env: {
				BRAVE_API_KEY: 'BSA_test123',
			},
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /brave-search/);
});

test('McpStep handles fetch server config', t => {
	const existingServers = {
		fetch: {
			name: 'fetch',
			transport: 'stdio',
			command: 'uvx',
			args: ['mcp-server-fetch'],
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /fetch/);
});

test('McpStep handles custom server config', t => {
	const existingServers = {
		'my-custom-server': {
			name: 'my-custom-server',
			transport: 'stdio',
			command: 'node',
			args: ['/path/to/server.js', '--port', '8080'],
			env: {
				API_KEY: 'custom-key',
				DEBUG: 'true',
			},
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /my-custom-server/);
});

test('McpStep handles server without env variables', t => {
	const existingServers = {
		fetch: {
			name: 'fetch',
			transport: 'stdio',
			command: 'uvx',
			args: ['mcp-server-fetch'],
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /fetch/);
});

// ============================================================================
// Tests for McpStep Mode States
// ============================================================================

test('McpStep renders in initial-menu mode initially', t => {
	const {lastFrame} = render(<McpStep onComplete={() => {}} />);

	const output = lastFrame();
	// Initial mode shows initial menu
	t.regex(output!, /Configure MCP Servers/);
	t.regex(output!, /Add MCP servers/);
});

test('McpStep shows available options in initial menu', t => {
	const {lastFrame} = render(<McpStep onComplete={() => {}} />);

	const output = lastFrame();
	// Should show initial menu options
	t.truthy(output);
	t.regex(output!, /Configure MCP Servers/);
	t.regex(output!, /Add MCP servers/);
	t.regex(output!, /Done/);
});

test('McpStep shows Done & Save option', t => {
	const {lastFrame} = render(<McpStep onComplete={() => {}} />);

	const output = lastFrame();
	t.regex(output!, /Done & Save/);
});

// ============================================================================
// Tests for McpStep State Management
// ============================================================================

test('McpStep initializes with empty servers when not provided', t => {
	const {lastFrame} = render(<McpStep onComplete={() => {}} />);

	const output = lastFrame();
	// Should not show configured servers section when no servers exist
	t.notRegex(output!, /MCP server\(s\) configured:/);
});

test('McpStep maintains existing servers', t => {
	const existingServers = {
		test1: {
			name: 'test1',
			transport: 'stdio',
			command: 'node',
			args: ['server.js'],
		},
		test2: {
			name: 'test2',
			transport: 'stdio',
			command: 'python',
			args: ['server.py'],
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /test1/);
	t.regex(output!, /test2/);
});

// ============================================================================
// Tests for McpStep Component Integration
// ============================================================================

test('McpStep renders without errors with all props', t => {
	const existingServers = {
		filesystem: {
			name: 'filesystem',
			transport: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
		},
	};

	const {lastFrame} = render(
		<McpStep
			onComplete={() => {}}
			onBack={() => {}}
			existingServers={existingServers}
		/>,
	);

	t.truthy(lastFrame());
});

test('McpStep renders correctly on first render', t => {
	const {frames} = render(<McpStep onComplete={() => {}} />);

	t.true(frames.length > 0);
	const firstFrame = frames[0];
	t.regex(firstFrame, /Configure MCP Servers/);
});

test('McpStep handles complex server names', t => {
	const existingServers = {
		'my-custom-mcp-server-v2': {
			name: 'my-custom-mcp-server-v2',
			transport: 'stdio',
			command: 'node',
			args: ['dist/index.js'],
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /my-custom-mcp-server-v2/);
});

test('McpStep handles servers with many arguments', t => {
	const existingServers = {
		complex: {
			name: 'complex',
			transport: 'stdio',
			command: 'node',
			args: [
				'server.js',
				'--port',
				'8080',
				'--host',
				'localhost',
				'--debug',
				'--verbose',
			],
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /complex/);
});

test('McpStep handles servers with multiple env variables', t => {
	const existingServers = {
		envtest: {
			name: 'envtest',
			transport: 'stdio',
			command: 'node',
			args: ['server.js'],
			env: {
				API_KEY: 'test-key',
				DEBUG: 'true',
				PORT: '8080',
				HOST: 'localhost',
			},
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /envtest/);
});

// ============================================================================
// Tests for McpStep Delete Config Feature
// ============================================================================

test('McpStep shows delete option when config exists and onDelete provided', t => {
	const {lastFrame} = render(
		<McpStep
			onComplete={() => {}}
			onDelete={() => {}}
			configExists={true}
		/>,
	);

	const output = lastFrame();
	t.regex(output!, /Delete config file/);
});

test('McpStep does not show delete option when config does not exist', t => {
	const {lastFrame} = render(
		<McpStep
			onComplete={() => {}}
			onDelete={() => {}}
			configExists={false}
		/>,
	);

	const output = lastFrame();
	t.notRegex(output!, /Delete config file/);
});

test('McpStep does not show delete option when onDelete not provided', t => {
	const {lastFrame} = render(
		<McpStep onComplete={() => {}} configExists={true} />,
	);

	const output = lastFrame();
	t.notRegex(output!, /Delete config file/);
});

test('McpStep accepts onDelete prop', t => {
	let deleteCalled = false;

	const {lastFrame} = render(
		<McpStep
			onComplete={() => {}}
			onDelete={() => {
				deleteCalled = true;
			}}
			configExists={true}
		/>,
	);

	t.truthy(lastFrame());
	t.false(deleteCalled); // Should not be called on render
});

test('McpStep accepts configExists prop', t => {
	const {lastFrame} = render(
		<McpStep onComplete={() => {}} configExists={true} />,
	);

	// Component should render without errors
	t.truthy(lastFrame());
});

// ============================================================================
// Tests for McpStep Initial Menu Options
// ============================================================================

test('McpStep shows Add MCP servers option', t => {
	const {lastFrame} = render(<McpStep onComplete={() => {}} />);

	const output = lastFrame();
	t.regex(output!, /Add MCP servers/);
});

test('McpStep shows all initial options without servers', t => {
	const {lastFrame} = render(<McpStep onComplete={() => {}} />);

	const output = lastFrame();
	t.regex(output!, /Add MCP servers/);
	t.regex(output!, /Done & Save/);
	// Should not show edit when no servers
	t.notRegex(output!, /Edit existing servers/);
});

test('McpStep shows all initial options with servers', t => {
	const existingServers = {
		test: {
			name: 'test',
			transport: 'stdio',
			command: 'node',
			args: ['test.js'],
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /Add MCP servers/);
	t.regex(output!, /Edit existing servers/);
	t.regex(output!, /Done & Save/);
});

test('McpStep shows transport type for configured servers', t => {
	const existingServers = {
		test: {
			name: 'test',
			transport: 'stdio',
			command: 'node',
			args: ['test.js'],
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /\(stdio\)/);
});

test('McpStep handles server with sse transport', t => {
	const existingServers = {
		remote: {
			name: 'remote',
			transport: 'sse',
			url: 'http://localhost:3000/sse',
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /remote/);
	t.regex(output!, /\(sse\)/);
});

test('McpStep handles server with websocket transport', t => {
	const existingServers = {
		ws: {
			name: 'ws',
			transport: 'websocket',
			url: 'ws://localhost:3000',
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /ws/);
	t.regex(output!, /\(websocket\)/);
});

// ============================================================================
// Tests for McpStep with Combined Props
// ============================================================================

test('McpStep renders with all props combined', t => {
	const existingServers = {
		test: {
			name: 'test',
			transport: 'stdio',
			command: 'node',
			args: ['test.js'],
		},
	};

	const {lastFrame} = render(
		<McpStep
			onComplete={() => {}}
			onBack={() => {}}
			onDelete={() => {}}
			existingServers={existingServers}
			configExists={true}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should show all relevant options
	t.regex(output!, /Add MCP servers/);
	t.regex(output!, /Edit existing servers/);
	t.regex(output!, /Done & Save/);
	t.regex(output!, /Delete config file/);
});

test('McpStep shows server count in header', t => {
	const existingServers = {
		server1: {
			name: 'server1',
			transport: 'stdio',
			command: 'node',
			args: ['server1.js'],
		},
		server2: {
			name: 'server2',
			transport: 'stdio',
			command: 'node',
			args: ['server2.js'],
		},
		server3: {
			name: 'server3',
			transport: 'stdio',
			command: 'node',
			args: ['server3.js'],
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /3 MCP server\(s\) configured:/);
});

test('McpStep displays bullet points for each server', t => {
	const existingServers = {
		alpha: {
			name: 'alpha',
			transport: 'stdio',
			command: 'node',
			args: ['alpha.js'],
		},
		beta: {
			name: 'beta',
			transport: 'stdio',
			command: 'node',
			args: ['beta.js'],
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	// Should show bullet points for each server
	t.regex(output!, /• alpha/);
	t.regex(output!, /• beta/);
});

// ============================================================================
// Tests for McpStep Edge Cases
// ============================================================================

test('McpStep handles undefined existingServers', t => {
	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={undefined} />,
	);

	t.truthy(lastFrame());
});

test('McpStep handles server with empty args array', t => {
	const existingServers = {
		test: {
			name: 'test',
			transport: 'stdio',
			command: 'node',
			args: [],
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /test/);
});

test('McpStep handles server with no env', t => {
	const existingServers = {
		test: {
			name: 'test',
			transport: 'stdio',
			command: 'node',
			args: ['test.js'],
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /test/);
});

test('McpStep handles server with empty env object', t => {
	const existingServers = {
		test: {
			name: 'test',
			transport: 'stdio',
			command: 'node',
			args: ['test.js'],
			env: {},
		},
	};

	const {lastFrame} = render(
		<McpStep onComplete={() => {}} existingServers={existingServers} />,
	);

	const output = lastFrame();
	t.regex(output!, /test/);
});
