import {readFileSync} from 'node:fs';
import {useCallback, useState} from 'react';
import {writeConfigFileAtomic} from '@/config/config-writer';
import {getClosestConfigFile} from '@/config/index';
import {JsonViewer} from '@/components/json-viewer';

/**
 * In-TUI editor for agents.config.json. The tree editor can only produce valid
 * JSON, and `w` writes it back atomically. Unsaved edits live only in the
 * viewer's state, so exiting without saving leaves the file untouched (real
 * rollback — no keep/discard prompt).
 */
export function SettingsJsonConfigPanel({
	onBack,
}: {
	onBack: () => void;
	onCancel: () => void;
}) {
	const [filePath] = useState(() => getClosestConfigFile('agents.config.json'));
	const [data] = useState<unknown>(() => {
		try {
			return JSON.parse(readFileSync(filePath, 'utf-8'));
		} catch {
			return {};
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
			title="agents.config.json"
			filePath={filePath}
			onSave={handleSave}
			onCancel={handleCancel}
		/>
	);
}
