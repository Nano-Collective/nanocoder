import React, {createContext, useContext} from 'react';

export interface PrivacyContextType {
	privacyEnabled: boolean;
	privacySessionIdRef: React.MutableRefObject<string> | null;
}

export const PrivacyContext = createContext<PrivacyContextType>({
	privacyEnabled: false,
	privacySessionIdRef: null,
});

export function usePrivacyContext() {
	return useContext(PrivacyContext);
}
