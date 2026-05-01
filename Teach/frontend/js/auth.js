(function (global) {
    'use strict';

    const apiClient = global.apiClient;
    const sharedConfig = global.sharedConfig;
    const authSession = global.authSession;
    const authRecovery = global.authRecovery;

    if (!apiClient || !sharedConfig || !authSession || !authRecovery) {
        console.warn('[TeachAuth] Missing dependencies. Teach login flow will be disabled.');
        global.TeachAuth = null;
        return;
    }

    const sessionStore = authSession.createAuthSessionStore({
        storageKeys: {
            token: 'sessionToken',
            participantCode: 'participantCode'
        }
    });

    function normalizeCode(code) {
        return String(code || '')
            .trim()
            .toUpperCase();
    }

    function clearStorage() {
        sessionStore.clearSession();
    }

    function getToken() {
        return sessionStore.getToken();
    }

    function getParticipantCode() {
        return sessionStore.getParticipantCode();
    }

    function persistSession(token, participantCode) {
        sessionStore.setSession(token, participantCode);
    }

    async function login(rawCode) {
        const participantCode = normalizeCode(rawCode);
        if (!participantCode) {
            throw new Error('Enter your participant code.');
        }

        const { response, data } = await apiClient.postJson('/api/auth/login', {
            participant_code: participantCode
        });

        if (!response.ok) {
            const detail = data && (data.detail || data.error || data.message);
            throw new Error(detail || 'Sign-in failed. Please check your participant code.');
        }

        const token = data?.token;
        if (!token) {
            throw new Error('The server did not return an auth token.');
        }

        persistSession(token, data?.participant_code || participantCode);
        return {
            token,
            participantCode: data?.participant_code || participantCode
        };
    }

    async function validateSession(token) {
        if (!token) {
            return null;
        }

        const { response, data } = await apiClient.get('/api/auth/session', {
            token
        });

        if (!response.ok) {
            return null;
        }

        const participantCode = normalizeCode(data?.participant_code || getParticipantCode());
        persistSession(token, participantCode);
        return {
            token,
            participantCode
        };
    }

    async function restoreSession() {
        const { token } = sessionStore.hydrateFromStorage();
        if (!token) {
            return false;
        }

        const session = await validateSession(token);
        if (!session) {
            clearStorage();
            return false;
        }

        return true;
    }

    function logout() {
        clearStorage();
    }

    async function silentReauthenticate() {
        const code = getParticipantCode();
        if (!code) {
            return false;
        }

        try {
            const { response, data } = await apiClient.postJson('/api/auth/login', {
                participant_code: code
            });

            if (!response.ok || !data?.token) {
                return false;
            }

            persistSession(data.token, data?.participant_code || code);
            return true;
        } catch (error) {
            console.error('[TeachAuth] Silent re-authentication failed:', error);
            return false;
        }
    }

    function forceReloginWithMessage(message) {
        logout();
        if (typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
            global.dispatchEvent(new global.CustomEvent('teach:auth-required', {
                detail: {
                    message: message || 'Your session expired. Please sign in again.'
                }
            }));
        }
    }

    async function callWithSessionRecovery(requestFn, options = {}) {
        const onAuthFailure = typeof options.onAuthFailure === 'function'
            ? options.onAuthFailure
            : () => forceReloginWithMessage(options.authFailureMessage);

        return authRecovery.callWithSessionRecovery(requestFn, {
            reauth: silentReauthenticate,
            onAuthFailure
        });
    }

    global.TeachAuth = {
        login,
        restoreSession,
        getToken,
        getParticipantCode,
        persistSession,
        logout,
        silentReauthenticate,
        forceReloginWithMessage,
        callWithSessionRecovery
    };
})(window);


