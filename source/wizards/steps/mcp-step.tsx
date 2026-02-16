import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {Tab, Tabs} from 'ink-tab';
import {useEffect, useState} from 'react';
import TextInput from '@/components/text-input';
import {colors} from '@/config/index';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {
	MCP_TEMPLATES,
	type McpServerConfig,
	type McpTemplate,
} from '../templates/mcp-templates';

interface McpStepProps {
	onComplete: (mcpServers: Record<string, McpServerConfig>) => void;
	onBack?: () => void;
	onDelete?: () => void;
	existingServers?: Record<string, McpServerConfig>;
	configExists?: boolean;
}

type Mode =
	| 'initial-menu'
	| 'tabs'
	| 'edit-selection'
	| 'edit-or-delete'
	| 'field-input';

interface TemplateOption {
	label: string;
	value: string;
	category?: string;
}

export function McpStep({
	onComplete,
	onBack,
	onDelete,
	existingServers = {},
	configExists = false,
}: McpStepProps) {
	const {isNarrow} = useResponsiveTerminal();
	const [servers, setServers] =
		useState<Record<string, McpServerConfig>>(existingServers);

	// Update servers when existingServers prop changes
	useEffect(() => {
		setServers(existingServers);
	}, [existingServers]);

	const [mode, setMode] = useState<Mode>('initial-menu');
	const [selectedTemplate, setSelectedTemplate] = useState<McpTemplate | null>(
		null,
	);
	const [currentFieldIndex, setCurrentFieldIndex] = useState(0);
	const [fieldAnswers, setFieldAnswers] = useState<Record<string, string>>({});
	const [currentValue, setCurrentValue] = useState('');
	const [multilineBuffer, setMultilineBuffer] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [inputKey, setInputKey] = useState(0);
	const [editingServerName, setEditingServerName] = useState<string | null>(
		null,
	);
	const [activeTab, setActiveTab] = useState<'local' | 'remote'>('local');

	const serverCount = Object.keys(servers).length;

	// Filter templates by category
	const localTemplates = MCP_TEMPLATES.filter(
		template => template.category === 'local',
	);
	const remoteTemplates = MCP_TEMPLATES.filter(
		template => template.category === 'remote',
	);

	// Initial menu options
	const initialOptions = [
		{label: 'Add MCP servers', value: 'add'},
		...(serverCount > 0
			? [{label: 'Edit existing servers', value: 'edit'}]
			: []),
		{label: 'Done & Save', value: 'done'},
		...(configExists && onDelete
			? [{label: 'Delete config file', value: 'delete'}]
			: []),
	];

	// Create template options for current tab
	const getTemplateOptions = (): TemplateOption[] => {
		if (mode === 'tabs') {
			const options: TemplateOption[] = [];
			const templates =
				activeTab === 'local' ? localTemplates : remoteTemplates;

			// Add templates for current tab
			templates.forEach(template => {
				options.push({
					label: isNarrow
						? `${template.name}`
						: `${template.name} - ${template.description}`,
					value: template.id,
					category: activeTab,
				});
			});

			// Add done option at the end
			options.push({
				label: 'Done & Save',
				value: 'done',
			});

			return options;
		}

		return [];
	};

	const handleInitialSelect = (item: {value: string}) => {
		if (item.value === 'add') {
			setMode('tabs');
		} else if (item.value === 'edit') {
			setMode('edit-selection');
		} else if (item.value === 'done') {
			onComplete(servers);
		} else if (item.value === 'delete' && onDelete) {
			onDelete();
		}
	};

	const handleTemplateSelect = (item: TemplateOption) => {
		if (item.value === 'done') {
			// Done adding servers
			onComplete(servers);
			return;
		}

		// Adding new server
		const template = MCP_TEMPLATES.find(t => t.id === item.value);
		if (template) {
			// Check if template has no fields
			if (template.fields.length === 0) {
				// Automatically build config and add server when no fields are required
				try {
					const serverConfig = template.buildConfig({});
					setServers({...servers, [serverConfig.name]: serverConfig});
					// Stay in tabs mode to allow adding more servers
					setMode('tabs');
				} catch (err) {
					setError(
						err instanceof Error
							? err.message
							: 'Failed to build configuration',
					);
				}
			} else {
				// Template has fields, proceed with normal flow
				setEditingServerName(null); // Not editing
				setSelectedTemplate(template);
				setCurrentFieldIndex(0);
				setFieldAnswers({});
				setCurrentValue(template.fields[0]?.default || '');
				setMultilineBuffer('');
				setError(null);
				setMode('field-input');
			}
		}
	};

	const handleEditSelect = (item: TemplateOption) => {
		// Store the server name and show edit/delete options
		if (item.value.startsWith('edit-')) {
			const serverKey = item.value.replace('edit-', '');
			setEditingServerName(serverKey);
			setMode('edit-or-delete');
		}
	};

	const handleEditOrDeleteChoice = (item: {value: string}) => {
		if (item.value === 'delete' && editingServerName !== null) {
			// Delete the server
			const newServers = {...servers};
			delete newServers[editingServerName];
			setServers(newServers);
			setEditingServerName(null);
			// Go back to initial menu after deleting
			setMode('initial-menu');
			return;
		}

		if (item.value === 'edit' && editingServerName !== null) {
			const server = servers[editingServerName];
			if (server) {
				// Find matching template by server name or use custom
				const template =
					MCP_TEMPLATES.find(t => t.id === server.name) ||
					MCP_TEMPLATES.find(t => t.id === editingServerName) ||
					MCP_TEMPLATES.find(t => t.id === 'custom');

				if (template) {
					setSelectedTemplate(template);
					setCurrentFieldIndex(0);

					// Pre-populate field answers from existing server
					const answers: Record<string, string> = {};

					// Map server properties to field names based on template fields
					for (const field of template.fields) {
						if (field.name === 'serverName' && server.name) {
							answers.serverName = server.name;
						} else if (field.name === 'url' && server.url) {
							answers.url = server.url;
						} else if (field.name === 'command' && server.command) {
							answers.command = server.command;
						} else if (field.name === 'allowedDirs' && server.args) {
							// Special handling for filesystem server - extract allowed directories
							const packageIndex = server.args.findIndex(arg =>
								arg.includes('@modelcontextprotocol/server-filesystem'),
							);
							if (packageIndex !== -1) {
								const dirs = server.args.slice(packageIndex + 1);
								answers.allowedDirs = dirs.join(', ');
							}
						} else if (field.name === 'args' && server.args) {
							answers.args = server.args.join(' ');
						} else if (field.name === 'envVars' && server.env) {
							answers.envVars = Object.entries(server.env)
								.map(([key, value]) => `${key}=${value}`)
								.join('\n');
						} else if (field.name === 'apiKey' && server.env) {
							// Try to find API key from env vars
							const apiKeyEntry = Object.entries(server.env).find(
								([key]) => key.includes('API_KEY') || key.includes('TOKEN'),
							);
							if (apiKeyEntry) {
								answers.apiKey = apiKeyEntry[1];
							}
						}
					}

					setFieldAnswers(answers);
					setCurrentValue(
						answers[template.fields[0]?.name] ||
							template.fields[0]?.default ||
							'',
					);
					setMultilineBuffer('');
					setError(null);
					setMode('field-input');
				}
			}
		}
	};

	const handleFieldSubmit = () => {
		if (!selectedTemplate) return;

		const currentField = selectedTemplate.fields[currentFieldIndex];
		if (!currentField) return;

		// For multiline fields, handle differently
		const isMultiline = currentField.name === 'envVars';
		const finalValue = isMultiline ? multilineBuffer : currentValue.trim();

		// Validate required fields
		if (currentField.required && !finalValue) {
			setError('This field is required');
			return;
		}

		// Validate with custom validator
		if (currentField.validator && finalValue) {
			const validationError = currentField.validator(finalValue);
			if (validationError) {
				setError(validationError);
				return;
			}
		}

		// Save answer
		const newAnswers = {
			...fieldAnswers,
			[currentField.name]: finalValue,
		};
		setFieldAnswers(newAnswers);
		setError(null);

		// Move to next field or complete
		if (currentFieldIndex < selectedTemplate.fields.length - 1) {
			setCurrentFieldIndex(currentFieldIndex + 1);
			const nextField = selectedTemplate.fields[currentFieldIndex + 1];
			setCurrentValue(newAnswers[nextField?.name] || nextField?.default || '');
			setMultilineBuffer('');
		} else {
			// Build config and add/update server
			try {
				const serverConfig = selectedTemplate.buildConfig(newAnswers);

				if (editingServerName !== null) {
					// Replace existing server (delete old, add new)
					const newServers = {...servers};
					delete newServers[editingServerName];
					newServers[serverConfig.name] = serverConfig;
					setServers(newServers);
				} else {
					// Add new server
					setServers({...servers, [serverConfig.name]: serverConfig});
				}

				// Reset for next server
				setSelectedTemplate(null);
				setCurrentFieldIndex(0);
				setFieldAnswers({});
				setCurrentValue('');
				setMultilineBuffer('');
				setEditingServerName(null);
				setMode('tabs');
			} catch (err) {
				setError(
					err instanceof Error ? err.message : 'Failed to build configuration',
				);
			}
		}
	};

	const editOptions: TemplateOption[] = [
		...Object.entries(servers).map(([key, server], index) => ({
			label: `${index + 1}. ${server.name}`,
			value: `edit-${key}`,
		})),
	];

	// Handle keyboard navigation
	useInput((input, key) => {
		// Handle Shift+Tab for going back (but not regular Tab, let Tabs component handle it)
		if (key.shift && key.tab) {
			if (mode === 'field-input') {
				// In field input mode, check if we can go back to previous field
				if (currentFieldIndex > 0) {
					// Go back to previous field
					setCurrentFieldIndex(currentFieldIndex - 1);
					const prevField = selectedTemplate?.fields[currentFieldIndex - 1];
					setCurrentValue(
						fieldAnswers[prevField?.name || ''] || prevField?.default || '',
					);
					setMultilineBuffer('');
					setInputKey(prev => prev + 1); // Force remount to reset cursor position
					setError(null);
				} else {
					// At first field, go back based on context
					if (editingServerName !== null) {
						// Was editing, go back to edit-or-delete choice
						setMode('edit-or-delete');
					} else {
						// Was adding, go back to tabs
						setMode('tabs');
					}
					setSelectedTemplate(null);
					setCurrentFieldIndex(0);
					setFieldAnswers({});
					setCurrentValue('');
					setMultilineBuffer('');
					setError(null);
				}
			} else if (mode === 'edit-or-delete') {
				// In edit-or-delete, go back to edit selection
				setEditingServerName(null);
				setMode('edit-selection');
			} else if (mode === 'edit-selection') {
				// In edit selection, go back to initial menu
				setMode('initial-menu');
			} else if (mode === 'tabs') {
				// At tabs screen, go back to initial menu
				setMode('initial-menu');
			} else if (mode === 'initial-menu' && onBack) {
				// At initial menu, call parent's onBack
				onBack();
			}
			return;
		}

		if (mode === 'field-input' && selectedTemplate) {
			const currentField = selectedTemplate.fields[currentFieldIndex];
			const isMultiline = currentField?.name === 'envVars';

			if (isMultiline) {
				// Handle multiline input
				if (key.return) {
					// Add newline to buffer
					setMultilineBuffer(multilineBuffer + '\n');
				} else if (key.escape) {
					// Submit multiline input on Escape
					handleFieldSubmit();
				} else if (!key.ctrl && !key.meta && input) {
					setMultilineBuffer(multilineBuffer + input);
				}
			} else {
				if (key.return) {
					handleFieldSubmit();
				} else if (key.escape) {
					// Go back to tabs or initial menu
					if (editingServerName !== null) {
						setMode('edit-or-delete');
					} else {
						setMode('tabs');
					}
					setSelectedTemplate(null);
					setCurrentFieldIndex(0);
					setFieldAnswers({});
					setCurrentValue('');
					setMultilineBuffer('');
					setError(null);
				}
			}
		}
	});

	if (mode === 'initial-menu') {
		return (
			<Box flexDirection="column">
				<Box marginBottom={1}>
					<Text bold color={colors.primary}>
						Configure MCP Servers
					</Text>
				</Box>
				{serverCount > 0 && (
					<Box flexDirection="column" marginBottom={1}>
						<Text color={colors.success}>
							{serverCount} MCP server(s) configured:
						</Text>
						{Object.values(servers).map((server, index) => (
							<Text key={index} color={colors.secondary}>
								• {server.name} ({server.transport})
							</Text>
						))}
					</Box>
				)}
				<SelectInput
					items={initialOptions}
					onSelect={(item: {value: string}) => handleInitialSelect(item)}
				/>
			</Box>
		);
	}

	if (mode === 'tabs') {
		const templateOptions = getTemplateOptions();

		return (
			<Box flexDirection="column">
				<Box marginBottom={1}>
					<Text bold color={colors.primary}>
						Add MCP Servers:
					</Text>
				</Box>
				{serverCount > 0 && (
					<Box marginBottom={1}>
						<Text color={colors.success}>
							Added:{' '}
							{Object.values(servers)
								.map(s => s.name)
								.join(', ')}
						</Text>
					</Box>
				)}
				<Tabs
					onChange={name => setActiveTab(name as 'local' | 'remote')}
					defaultValue={activeTab}
					flexDirection="row"
					colors={{
						activeTab: {
							color: colors.success,
						},
					}}
				>
					<Tab name="local">Local Servers (STDIO)</Tab>
					<Tab name="remote">Remote Servers (HTTP/WebSocket)</Tab>
				</Tabs>
				<Box marginTop={1} marginBottom={1}>
					<Text>
						{activeTab === 'local'
							? 'Select a local MCP server to add:'
							: 'Select a remote MCP server to add:'}
					</Text>
				</Box>
				<SelectInput items={templateOptions} onSelect={handleTemplateSelect} />
				<Box marginTop={1}>
					<Text color={colors.secondary}>
						Arrow keys: Navigate | Tab: Switch tabs
					</Text>
				</Box>
			</Box>
		);
	}

	if (mode === 'edit-selection') {
		return (
			<Box flexDirection="column">
				<Box marginBottom={1}>
					<Text bold color={colors.primary}>
						Select an MCP server to edit:
					</Text>
				</Box>
				<SelectInput
					items={editOptions}
					onSelect={(item: TemplateOption) => handleEditSelect(item)}
				/>
			</Box>
		);
	}

	if (mode === 'edit-or-delete') {
		const server =
			editingServerName !== null ? servers[editingServerName] : null;
		const editOrDeleteOptions = [
			{label: 'Edit this server', value: 'edit'},
			{label: 'Delete this server', value: 'delete'},
		];

		return (
			<Box flexDirection="column">
				<Box marginBottom={1}>
					<Text bold color={colors.primary}>
						{server?.name} - What would you like to do?
					</Text>
				</Box>
				<SelectInput
					items={editOrDeleteOptions}
					onSelect={(item: {value: string}) => handleEditOrDeleteChoice(item)}
				/>
			</Box>
		);
	}

	if (mode === 'field-input' && selectedTemplate) {
		const currentField = selectedTemplate.fields[currentFieldIndex];
		if (!currentField) return null;

		const isMultiline = currentField.name === 'envVars';

		return (
			<Box flexDirection="column">
				<Box marginBottom={1}>
					<Text bold color={colors.primary}>
						{selectedTemplate.name} Configuration
					</Text>
					<Text dimColor>
						{' '}
						(Field {currentFieldIndex + 1}/{selectedTemplate.fields.length})
					</Text>
				</Box>

				<Box>
					<Text>
						{currentField.prompt}
						{currentField.required && <Text color={colors.error}> *</Text>}
						{currentField.default && (
							<Text dimColor> [{currentField.default}]</Text>
						)}
						: {currentField.sensitive && '****'}
					</Text>
				</Box>

				{isMultiline ? (
					<Box flexDirection="column" marginBottom={1}>
						<Box
							borderStyle="round"
							borderColor={colors.secondary}
							paddingX={1}
						>
							<Text>{multilineBuffer || <Text dimColor>(empty)</Text>}</Text>
						</Box>
						<Box marginTop={1}>
							<Text color={colors.secondary}>
								Type to add lines. Press Esc when done to submit.
							</Text>
						</Box>
					</Box>
				) : currentField.sensitive ? (
					<Box
						marginBottom={1}
						borderStyle="round"
						borderColor={colors.secondary}
					>
						<TextInput
							key={inputKey}
							value={currentValue}
							onChange={setCurrentValue}
							onSubmit={handleFieldSubmit}
							mask="*"
						/>
					</Box>
				) : (
					<Box
						marginBottom={1}
						borderStyle="round"
						borderColor={colors.secondary}
					>
						<TextInput
							key={inputKey}
							value={currentValue}
							onChange={setCurrentValue}
							onSubmit={handleFieldSubmit}
						/>
					</Box>
				)}

				{error && (
					<Box marginBottom={1}>
						<Text color={colors.error}>{error}</Text>
					</Box>
				)}

				<Box>
					<Text color={colors.secondary}>
						{isMultiline ? 'Press Esc to submit' : 'Press Enter to continue'}
					</Text>
				</Box>
			</Box>
		);
	}

	return null;
}
