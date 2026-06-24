(function (global) {
    'use strict';

    function isUnauthorizedResponse(response) {
        return Boolean(response) && response.status === 401;
    }

    function getAuthErrorMessage(data) {
        if (!data) {
            return '';
        }
        return String(data.detail || data.error || data.message || '').toLowerCase();
    }

    function isExpiredTokenError(response, data) {
        if (!isUnauthorizedResponse(response)) {
            return false;
        }
        const message = getAuthErrorMessage(data);
        return message.includes('invalid or expired token')
            || message.includes('expired token')
            || message.includes('invalid token');
    }

    async function callWithAutoReauth(requestFn, handlers = {}) {
        const {
            shouldRetry = isExpiredTokenError,
            reauth,
            onAuthFailure
        } = handlers;

        let result = await requestFn();
        if (!shouldRetry(result.response, result.data)) {
            return result;
        }

        const refreshed = typeof reauth === 'function'
            ? await reauth()
            : false;
        if (!refreshed) {
            if (typeof onAuthFailure === 'function') {
                onAuthFailure(result);
            }
            return {
                ...result,
                authFailureHandled: true
            };
        }

        result = await requestFn();
        if (shouldRetry(result.response, result.data)) {
            if (typeof onAuthFailure === 'function') {
                onAuthFailure(result);
            }
            return {
                ...result,
                authFailureHandled: true
            };
        }

        return result;
    }

    async function callWithSessionRecovery(requestFn, handlers = {}) {
        const {
            ensureInitialized
        } = handlers;

        let result = await callWithAutoReauth(requestFn, handlers);
        if (result.authFailureHandled) {
            return result;
        }

        if (typeof ensureInitialized !== 'function') {
            return result;
        }

        const initDecision = await ensureInitialized(result);
        if (initDecision === true) {
            return result;
        }
        if (initDecision && typeof initDecision === 'object') {
            if (initDecision.authFailureHandled) {
                return {
                    ...result,
                    authFailureHandled: true
                };
            }
            if (initDecision.retry === false) {
                return result;
            }
            if (initDecision.retry === true) {
                result = await callWithAutoReauth(requestFn, handlers);
                return result;
            }
        }
        if (initDecision === false) {
            result = await callWithAutoReauth(requestFn, handlers);
            return result;
        }

        return result;
    }

    global.authRecovery = global.authRecovery || {
        isExpiredTokenError,
        callWithAutoReauth,
        callWithSessionRecovery
    };
})(window);
