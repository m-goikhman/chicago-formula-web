(function (global) {
    'use strict';

    const DEFAULT_KEYS = {
        token: 'sessionToken',
        participantCode: 'participantCode'
    };

    function normalizeCode(code) {
        return String(code || '')
            .trim()
            .toUpperCase();
    }

    function createAuthSessionStore(options = {}) {
        const storageKeys = {
            token: options.storageKeys?.token || DEFAULT_KEYS.token,
            participantCode: options.storageKeys?.participantCode || DEFAULT_KEYS.participantCode
        };

        let token = '';
        let participantCode = '';

        function readStorage(key) {
            try {
                return global.localStorage?.getItem(key) || '';
            } catch (error) {
                console.warn('[AuthSession] Unable to read localStorage key:', key, error);
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
                console.warn('[AuthSession] Unable to write localStorage key:', key, error);
            }
        }

        function hydrateFromStorage() {
            token = readStorage(storageKeys.token);
            participantCode = normalizeCode(readStorage(storageKeys.participantCode));
            return {
                token,
                participantCode
            };
        }

        function setSession(nextToken, nextParticipantCode) {
            token = String(nextToken || '').trim();
            participantCode = normalizeCode(nextParticipantCode);
            writeStorage(storageKeys.token, token);
            writeStorage(storageKeys.participantCode, participantCode);
            return {
                token,
                participantCode
            };
        }

        function clearSession() {
            token = '';
            participantCode = '';
            writeStorage(storageKeys.token, null);
            writeStorage(storageKeys.participantCode, null);
        }

        function getToken() {
            if (token) {
                return token;
            }
            token = readStorage(storageKeys.token);
            return token;
        }

        function getParticipantCode() {
            if (participantCode) {
                return participantCode;
            }
            participantCode = normalizeCode(readStorage(storageKeys.participantCode));
            return participantCode;
        }

        hydrateFromStorage();

        return {
            hydrateFromStorage,
            setSession,
            clearSession,
            getToken,
            getParticipantCode
        };
    }

    global.authSession = global.authSession || {
        createAuthSessionStore
    };
})(window);
