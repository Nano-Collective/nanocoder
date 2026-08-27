import {readFileSync} from 'node:fs';
import {useCallback, useState} from 'react';
import {JsonViewer} from '@/components/json-viewer';
import {writeConfigFileAtomic} from '@/config/config-writer';
import {getClosestConfigFile} from '@/config/index';

/**
 * In-TUI editor for a JSON config file (agents.config.json, .mcp.json, …). The
 * tree editor can only produce valid JSON, and `w` writes it back atomically.
 * Unsaved edits live only in the viewer's state, so exiting without saving
 * leaves the file untouched (real rollback — no keep/discard prompt).
 */
export function SettingsJsonConfigPanel({
	configFileName = 'agents.config.json',
	title,
	initialPath,
	onBack,
}: {
	configFileName?: string;
	title?: string;
	initialPath?: string[];
	onBack: () => void;
	onCancel: () => void;
}) {
	const [filePath] = useState(() => getClosestConfigFile(configFileName));
	const [data] = useState<unknown>(() => {
		try {
			return JSON.parse(readFileSync(filePath, 'utf-8'));
		} catch {
			// Missing/empty file: seed the expected shape so the editor is usable.
			return configFileName.includes('mcp') ? {mcpServers: {}} : {};
		}
	});

	const handleSave = useCallback(
		(next: unknown) => writeConfigFileAtomic(filePath, next),
		[filePath],
	);
	const handleCancel = useCallback(() => onBack(), [onBack]);

	return (
		<JsonViewer
			data={data}
			title={title ?? configFileName}
			filePath={filePath}
			initialPath={initialPath}
			onSave={handleSave}
			onCancel={handleCancel}
		/>
	);
}
