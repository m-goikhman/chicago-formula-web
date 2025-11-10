// Shared configuration helpers for Teach/Tell frontends
(function (global) {
    'use strict';

    const existingConfig = global.sharedConfig || {};

    const isLocalhost = Boolean(
        global.location.hostname === 'localhost' ||
        global.location.hostname === '127.0.0.1' ||
        global.location.protocol === 'file:'
    );

    const sharedConfig = Object.assign(existingConfig, {
        isLocalhost,
        apiBaseUrl: existingConfig.apiBaseUrl ?? null,
        resolveApiBase(options = {}) {
            if (options.override) {
                return this.setApiBase(options.override);
            }

            const local = options.local ?? options.localApiBaseUrl;
            const production = options.production ?? options.productionApiBaseUrl;
            const fallback = options.fallback ?? options.fallbackApiBaseUrl ?? '';

            let resolved = this.apiBaseUrl;
            if (!resolved) {
                if (this.isLocalhost && local) {
                    resolved = local;
                } else if (!this.isLocalhost && production) {
                    resolved = production;
                } else {
                    resolved = local || production || fallback;
                }
            }

            return this.setApiBase(resolved);
        },
        setApiBase(url) {
            this.apiBaseUrl = url;
            return this.apiBaseUrl;
        },
        getApiBase() {
            return this.apiBaseUrl;
        }
    });

    global.sharedConfig = sharedConfig;
})(window);

