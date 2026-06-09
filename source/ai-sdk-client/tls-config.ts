import {existsSync, readFileSync} from 'node:fs';
import type {ConnectionOptions} from 'node:tls';
import type {AIProviderConfig} from '@/types/index';

export function getTlsConnectOptions(
	providerConfig: AIProviderConfig,
): Partial<ConnectionOptions> {
	const caCertPath = providerConfig.config.caCertPath?.trim();
	if (!caCertPath) {
		return {};
	}

	if (!existsSync(caCertPath)) {
		throw new Error(`CA certificate file not found: ${caCertPath}`);
	}

	const ca = readFileSync(caCertPath, 'utf8');
	if (!ca.trim()) {
		throw new Error(`CA certificate file is empty: ${caCertPath}`);
	}

	return {ca};
}
