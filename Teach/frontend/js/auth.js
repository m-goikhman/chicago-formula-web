(function (global) {
    'use strict';

    const apiClient = global.apiClient;
    const sharedConfig = global.sharedConfig;

    if (!apiClient || !sharedConfig) {
        console.warn('[TeachAuth] apiClient or sharedConfig is not available. Teach login flow will be disabled.');
        global.TeachAuth = null;
        return;
    }

    const STORAGE_KEYS = {
        token: 'sessionToken',
        participantCode: 'participantCode'
    };

    function normalizeCode(code) {
        return String(code || '')
            .trim()
            .toUpperCase();
    }

    function readStorage(key) {
        try {
            return global.localStorage?.getItem(key) || '';
        } catch (error) {
            console.warn('[TeachAuth] Unable to read localStorage key', key, error);
            return '';
        }
    }

    function writeStorage(key, value) {
        try {
            if (!global.localStorage) {
                return;
            }
            if (value == null || value === '') {
                global.localStorage.removeItem(key);
            } else {
                global.localStorage.setItem(key, value);
            }
        } catch (error) {
            console.warn('[TeachAuth] Unable to write localStorage key', key, error);
        }
    }

    function clearStorage() {
        writeStorage(STORAGE_KEYS.token, null);
        writeStorage(STORAGE_KEYS.participantCode, null);
    }

    function getToken() {
        return readStorage(STORAGE_KEYS.token);
    }

    function getParticipantCode() {
        return readStorage(STORAGE_KEYS.participantCode);
    }

    function persistSession(token, participantCode) {
        if (token) {
            writeStorage(STORAGE_KEYS.token, token);
        }
        if (participantCode) {
            writeStorage(STORAGE_KEYS.participantCode, normalizeCode(participantCode));
        }
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
        const token = getToken();
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

    global.TeachAuth = {
        login,
        restoreSession,
        getToken,
        getParticipantCode,
        persistSession,
        logout
    };
})(window);


