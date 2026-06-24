/**
 * Cross-origin session handoff (Portal → Teach / Tell).
 * Portal appends session_token + participant_code to the redirect URL;
 * target apps consume them into localStorage and strip from the address bar.
 */
(function (global) {
    'use strict';

    const PARAM_TOKEN = 'session_token';
    const PARAM_CODE = 'participant_code';
    const PARAM_EPISODE = 'episode';
    const RESUME_CLASS = 'auth-resume-pending';

    function normalizeCode(code) {
        const raw = String(code || '').trim();
        if (/^[1-9]\d{1,6}$/.test(raw)) {
            return raw;
        }
        return raw.toUpperCase();
    }

    function buildHandoffUrl(destination, token, participantCode, options = {}) {
        if (!destination || !token || !participantCode) {
            return destination;
        }
        try {
            const url = new URL(destination, global.location.href);
            url.searchParams.set(PARAM_TOKEN, String(token).trim());
            url.searchParams.set(PARAM_CODE, normalizeCode(participantCode));
            const episode = options.episode ?? global.portalParams?.getStoredEpisode?.();
            if (episode) {
                url.searchParams.set(PARAM_EPISODE, String(episode));
            }
            return url.toString();
        } catch (error) {
            console.warn('[AuthHandoff] Could not build handoff URL:', error);
            return destination;
        }
    }

    function consumeHandoffFromLocation(options = {}) {
        const tokenKey = options.tokenKey || 'sessionToken';
        const participantCodeKey = options.participantCodeKey || 'participantCode';

        try {
            const url = new URL(global.location.href);
            const token = url.searchParams.get(PARAM_TOKEN);
            const code = url.searchParams.get(PARAM_CODE);

            if (!token || !code) {
                return null;
            }

            const normalizedCode = normalizeCode(code);
            const trimmedToken = String(token).trim();

            if (!global.localStorage) {
                return null;
            }

            global.localStorage.setItem(tokenKey, trimmedToken);
            global.localStorage.setItem(participantCodeKey, normalizedCode);

            const episode = url.searchParams.get(PARAM_EPISODE);
            if (episode && global.portalParams?.storePortalParams) {
                global.portalParams.storePortalParams({ episode });
            }

            url.searchParams.delete(PARAM_TOKEN);
            url.searchParams.delete(PARAM_CODE);
            const cleaned = `${url.pathname}${url.search}${url.hash}`;
            global.history.replaceState({}, '', cleaned || url.pathname);

            return {
                token: trimmedToken,
                participantCode: normalizedCode
            };
        } catch (error) {
            console.warn('[AuthHandoff] Failed to consume handoff:', error);
            return null;
        }
    }

    function hasHandoffInUrl() {
        try {
            const url = new URL(global.location.href);
            return url.searchParams.has(PARAM_TOKEN) && url.searchParams.has(PARAM_CODE);
        } catch (error) {
            return false;
        }
    }

    function hasStoredSession() {
        try {
            return Boolean(
                global.localStorage?.getItem('sessionToken')
                && global.localStorage?.getItem('participantCode')
            );
        } catch (error) {
            return false;
        }
    }

    function shouldResumeSession() {
        return hasHandoffInUrl() || hasStoredSession();
    }

    function setAuthResumePending() {
        global.document?.documentElement?.classList.add(RESUME_CLASS);
    }

    function clearAuthResumePending() {
        global.document?.documentElement?.classList.remove(RESUME_CLASS);
    }

    function applyEarlyAuthResumeHint() {
        if (shouldResumeSession()) {
            setAuthResumePending();
        }
    }

    global.authHandoff = {
        PARAM_TOKEN,
        PARAM_CODE,
        PARAM_EPISODE,
        RESUME_CLASS,
        buildHandoffUrl,
        consumeHandoffFromLocation,
        shouldResumeSession,
        setAuthResumePending,
        clearAuthResumePending,
        applyEarlyAuthResumeHint
    };

    applyEarlyAuthResumeHint();
})(window);
