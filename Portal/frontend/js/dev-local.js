/**
 * Local dev overrides when frontends run on separate ports (see dev-local.sh).
 * No-op on production hosts.
 */
(function (global) {
    'use strict';

    const host = global.location.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') {
        return;
    }

    const params = new URLSearchParams(global.location.search || '');
    const tellPort = params.get('tellPort') || '3081';
    const teachPort = params.get('teachPort') || '3082';

    global.portalDestinations = Object.assign({}, global.portalDestinations || {}, {
        tellLocal: `http://127.0.0.1:${tellPort}/`,
        teachLocal: `http://127.0.0.1:${teachPort}/`
    });
})(window);
