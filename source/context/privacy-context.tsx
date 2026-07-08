import React, {createContext, useContext} from 'react';

export interface PrivacyContextType {
	privacyEnabled: boolean;
	privacySessionMapRef: React.MutableRefObject<Record<string, string>> | null;
}

export const PrivacyContext = createContext<PrivacyContextType>({
	privacyEnabled: false,
	privacySessionMapRef: null,
});

export function usePrivacyContext() {
	return useContext(PrivacyContext);
}
