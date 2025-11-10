(function (global) {
    'use strict';

    function createSharedConfig() {
        const isLocalhost = Boolean(
            global.location.hostname === 'localhost' ||
            global.location.hostname === '127.0.0.1' ||
            global.location.protocol === 'file:'
        );

        let apiBaseUrl = null;

        function setApiBase(url) {
            if (!url) {
                return apiBaseUrl;
            }
            apiBaseUrl = url.replace(/\/+$/, '');
            return apiBaseUrl;
        }

        function getApiBase() {
            return apiBaseUrl;
        }

        function resolveApiBase(options = {}) {
            if (options.override) {
                return setApiBase(options.override);
            }

            const local = options.local ?? options.localApiBaseUrl;
            const production = options.production ?? options.productionApiBaseUrl;
            const fallback = options.fallback ?? options.fallbackApiBaseUrl ?? '';

            let resolved = apiBaseUrl;
            if (!resolved) {
                if (isLocalhost && local) {
                    resolved = local;
                } else if (!isLocalhost && production) {
                    resolved = production;
                } else {
                    resolved = local || production || fallback;
                }
            }

            return setApiBase(resolved);
        }

        return {
            isLocalhost,
            resolveApiBase,
            setApiBase,
            getApiBase
        };
    }

    function createApiClient(config) {
        function ensureBaseUrl() {
            const base = config.getApiBase?.();
            if (!base) {
                throw new Error('API base URL is not configured');
            }
            return base.replace(/\/+$/, '');
        }

        function normalizePath(path) {
            if (!path) {
                return '';
            }
            if (path.startsWith('http://') || path.startsWith('https://')) {
                return path;
            }
            return `/${path}`.replace(/\/{2,}/g, '/');
        }

        async function parseJsonResponse(response) {
            try {
                const text = await response.text();
                if (!text) {
                    return null;
                }
                return JSON.parse(text);
            } catch (error) {
                console.warn('Failed to parse JSON response:', error);
                return null;
            }
        }

        async function request(path, options = {}) {
            const {
                method = 'GET',
                headers = {},
                token,
                body,
                parseJson = true,
                fetchOptions = {}
            } = options;

            const baseUrl = ensureBaseUrl();
            const url = normalizePath(path);
            const fullUrl = url.startsWith('http://') || url.startsWith('https://')
                ? url
                : `${baseUrl}${url}`;

            const finalHeaders = new Headers(headers);
            if (token) {
                finalHeaders.set('Authorization', `Bearer ${token}`);
            }

            const fetchConfig = Object.assign({}, fetchOptions, {
                method,
                headers: finalHeaders
            });

            if (body !== undefined && body !== null) {
                fetchConfig.body = body;
            }

            const response = await fetch(fullUrl, fetchConfig);
            const data = parseJson ? await parseJsonResponse(response) : null;

            return { response, data };
        }

        function get(path, options = {}) {
            return request(path, Object.assign({}, options, { method: 'GET' }));
        }

        function postJson(path, payload = {}, options = {}) {
            const headers = Object.assign({}, options.headers, {
                'Content-Type': 'application/json'
            });

            return request(path, Object.assign({}, options, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload ?? {})
            }));
        }

        return {
            request,
            get,
            postJson
        };
    }

    const sharedConfig = createSharedConfig();

    const API_URL = sharedConfig.resolveApiBase({
        local: 'http://localhost:8000',
        production: 'https://teach-tell-backend-801526931549.europe-west4.run.app',
        fallback: 'http://localhost:8000'
    });

    const apiClient = createApiClient(sharedConfig);
    global.API_URL = API_URL;
    global.portalConfig = sharedConfig;

    const DEFAULT_DESTINATIONS = {
        teach: '../../Teach/frontend/index.html',
        tell: '../../Tell/frontend/index.html'
    };

    const destinationsOverride = global.portalDestinations || {};

    function resolveDestination(mode) {
        const isLocal = sharedConfig.isLocalhost;
        const overrideKey = isLocal ? `${mode}Local` : `${mode}Production`;
        const override = destinationsOverride[overrideKey];
        if (override) {
            return override;
        }

        if (!isLocal) {
            const localFallback = destinationsOverride[`${mode}Local`];
            if (localFallback) {
                return localFallback;
            }
        }

        return DEFAULT_DESTINATIONS[mode];
    }

    const loginView = document.getElementById('loginView');
    const modeSelectView = document.getElementById('modeSelectView');
    const participantInput = document.getElementById('participantCode');
    const loginButton = document.getElementById('loginButton');
    const loginError = document.getElementById('loginError');
    const loginStatus = document.getElementById('loginStatus');
    const sessionCodeEl = document.getElementById('sessionCode');
    const modeStatus = document.getElementById('modeStatus');
    const switchCodeButton = document.getElementById('switchCodeButton');
    const enterTeachButton = document.querySelector('[data-action="enter-teach"]');
    const enterTellButton = document.querySelector('[data-action="enter-tell"]');

    function setLoading(isLoading) {
        if (isLoading) {
            loginButton.classList.add('loading');
            loginButton.disabled = true;
            loginButton.textContent = 'Checking code…';
        } else {
            loginButton.classList.remove('loading');
            loginButton.disabled = false;
            loginButton.textContent = 'Unlock access';
        }
    }

    function clearMessages() {
        loginError.textContent = '';
        loginStatus.textContent = '';
        modeStatus.textContent = '';
    }

    function persistSession(token, participantCode) {
        if (!token || !participantCode) {
            return;
        }
        localStorage.setItem('sessionToken', token);
        localStorage.setItem('participantCode', participantCode);
    }

    function clearStoredSession() {
        localStorage.removeItem('sessionToken');
        localStorage.removeItem('participantCode');
    }

    function getStoredSession() {
        const token = localStorage.getItem('sessionToken');
        const code = localStorage.getItem('participantCode');
        if (!token || !code) {
            return null;
        }
        return { token, code };
    }

    function showModeSelect(participantCode, options = {}) {
        sessionCodeEl.textContent = participantCode ?? '—';
        loginView.classList.add('hidden');
        modeSelectView.classList.add('active');
        if (options.showStatus) {
            modeStatus.textContent = options.showStatus;
        } else {
            modeStatus.textContent = '';
        }
    }

    function showLoginView() {
        loginView.classList.remove('hidden');
        modeSelectView.classList.remove('active');
        clearMessages();
        loginStatus.textContent = 'Session cleared. Enter a new participant code.';
    }

    async function handleLogin() {
        const rawCode = participantInput.value.trim();
        if (!rawCode) {
            loginError.textContent = 'Please enter the participant code provided to you.';
            return;
        }

        const normalizedCode = rawCode.toUpperCase();
        clearMessages();
        setLoading(true);

        try {
            const { response, data } = await apiClient.postJson('/api/auth/login', {
                participant_code: normalizedCode
            });

            if (!response.ok) {
                const detail = (data && (data.detail || data.error || data.message)) || 'Login failed. Please check your code.';
                loginError.textContent = detail;
                return;
            }

            const token = data?.token;
            const participantCode = (data?.participant_code || normalizedCode).toUpperCase();

            persistSession(token, participantCode);
            participantInput.value = '';

            loginStatus.textContent = 'Success! Choose your mode below.';
            showModeSelect(participantCode, { showStatus: 'Session ready. You can move between Teach and Tell at any time.' });
        } catch (error) {
            console.error('[Portal] Login failed:', error);
            loginError.textContent = 'Could not reach the server. Please check your connection or try again later.';
        } finally {
            setLoading(false);
        }
    }

    async function tryRestoreSession() {
        const stored = getStoredSession();
        if (!stored) {
            return false;
        }

        clearMessages();
        loginStatus.textContent = 'Restoring your previous session…';

        try {
            const { response, data } = await apiClient.get('/api/auth/session', {
                token: stored.token
            });

            if (!response.ok) {
                throw new Error((data && (data.detail || data.error || data.message)) || 'Session invalid');
            }

            const participantCode = (data && data.participant_code) || stored.code;
            persistSession(stored.token, participantCode);
            showModeSelect(participantCode, { showStatus: 'Session restored. Choose a mode to continue.' });
            return true;
        } catch (error) {
            console.warn('[Portal] Stored session is no longer valid:', error);
            clearStoredSession();
            loginStatus.textContent = 'Your previous session expired. Please enter your participant code again.';
            return false;
        }
    }

    function navigateTo(mode) {
        const destination = resolveDestination(mode);
        if (!destination) {
            modeStatus.textContent = `Destination for ${mode} mode is not configured.`;
            return;
        }
        window.location.assign(destination);
    }

    loginButton.addEventListener('click', handleLogin);

    participantInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            handleLogin();
        }
    });

    enterTeachButton.addEventListener('click', () => navigateTo('teach'));
    enterTellButton.addEventListener('click', () => navigateTo('tell'));

    switchCodeButton.addEventListener('click', () => {
        clearStoredSession();
        showLoginView();
        if (participantInput) {
            participantInput.focus();
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        tryRestoreSession().then((restored) => {
            if (!restored && participantInput) {
                participantInput.focus();
            }
        });
    });
})(window);

