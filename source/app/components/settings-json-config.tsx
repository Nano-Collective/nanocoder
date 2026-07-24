import {useCallback} from 'react';
import {JsonViewer} from '@/components/json-viewer';
import {getAppConfig} from '@/config/index';

/**
 * Read-only tree view of the effective agents.config.json. First slice of the
 * in-TUI JSON editor; write-back (atomic) lands in a follow-up.
 */
export function SettingsJsonConfigPanel({
	onBack,
}: {
	onBack: () => void;
	onCancel: () => void;
}) {
	const config = getAppConfig();
	const handleCancel = useCallback(() => onBack(), [onBack]);
	return (
		<JsonViewer
			data={config}
			title="agents.config.json (effective)"
			readOnly
			onCancel={handleCancel}
		/>
	);
}
