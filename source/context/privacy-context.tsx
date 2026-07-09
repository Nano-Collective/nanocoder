import React, {createContext} from 'react';

export interface PrivacyContextType {
	privacyEnabled: boolean;
	privacySessionMapRef: React.MutableRefObject<Record<string, string>> | null;
}

export const PrivacyContext = createContext<PrivacyContextType>({
	privacyEnabled: false,
	privacySessionMapRef: null,
});
