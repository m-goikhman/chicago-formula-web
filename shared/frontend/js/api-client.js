// Shared API client helpers for Teach/Tell frontends
(function (global) {
    'use strict';

    const sharedConfig = global.sharedConfig;
    if (!sharedConfig) {
        throw new Error('sharedConfig must be loaded before apiClient');
    }

    function ensureBaseUrl() {
        const base = sharedConfig.getApiBase?.() ?? sharedConfig.apiBaseUrl;
        if (!base) {
            throw new Error('API base URL is not configured. Call sharedConfig.resolveApiBase() or setApiBase() first.');
        }
        return base.replace(/\/+$/, ''); // remove trailing slash
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

    function putJson(path, payload = {}, options = {}) {
        const headers = Object.assign({}, options.headers, {
            'Content-Type': 'application/json'
        });

        return request(path, Object.assign({}, options, {
            method: 'PUT',
            headers,
            body: JSON.stringify(payload ?? {})
        }));
    }

    function del(path, options = {}) {
        return request(path, Object.assign({}, options, { method: 'DELETE' }));
    }

    global.apiClient = {
        request,
        get,
        postJson,
        putJson,
        del
    };
})(window);

