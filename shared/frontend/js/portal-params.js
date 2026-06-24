/**
 * Portal / study URL params: SONA participant id and episode deep links.
 */
(function (global) {
    'use strict';

    const PARAM_SONA_ID = 'sona_id';
    const PARAM_EPISODE = 'episode';
    const STORAGE_SONA_ID = 'portal_sona_id';
    const STORAGE_EPISODE = 'portal_episode';
    const MIN_EPISODE = 1;
    const MAX_EPISODE = 4;

    function parseEpisodeValue(raw) {
        if (raw === null || raw === undefined || raw === '') {
            return null;
        }
        const parsed = Number.parseInt(String(raw).trim(), 10);
        if (!Number.isFinite(parsed) || parsed < MIN_EPISODE || parsed > MAX_EPISODE) {
            return null;
        }
        return parsed;
    }

    function parseSonaIdValue(raw) {
        const normalized = String(raw || '').trim();
        if (!normalized) {
            return null;
        }
        if (/^[1-9]\d{1,6}$/.test(normalized)) {
            return normalized;
        }
        return null;
    }

    function parseEpisodeFromSearchParams(searchParams) {
        if (!searchParams) {
            return null;
        }
        return parseEpisodeValue(searchParams.get(PARAM_EPISODE));
    }

    function parseSonaIdFromSearchParams(searchParams) {
        if (!searchParams) {
            return null;
        }
        return parseSonaIdValue(searchParams.get(PARAM_SONA_ID));
    }

    function getStoredSonaId() {
        try {
            return parseSonaIdValue(global.sessionStorage?.getItem(STORAGE_SONA_ID));
        } catch (error) {
            return null;
        }
    }

    function getStoredEpisode() {
        try {
            return parseEpisodeValue(global.sessionStorage?.getItem(STORAGE_EPISODE));
        } catch (error) {
            return null;
        }
    }

    function storePortalParams({ sonaId, episode } = {}) {
        try {
            const storage = global.sessionStorage;
            if (!storage) {
                return;
            }
            const parsedSonaId = parseSonaIdValue(sonaId);
            const parsedEpisode = parseEpisodeValue(episode);
            if (parsedSonaId) {
                storage.setItem(STORAGE_SONA_ID, parsedSonaId);
            }
            if (parsedEpisode) {
                storage.setItem(STORAGE_EPISODE, String(parsedEpisode));
            }
        } catch (error) {
            console.warn('[PortalParams] Failed to store params:', error);
        }
    }

    function consumePortalParamsFromLocation(options = {}) {
        try {
            const url = new URL(global.location.href);
            const sonaId = parseSonaIdFromSearchParams(url.searchParams);
            const episode = parseEpisodeFromSearchParams(url.searchParams);

            if (sonaId || episode) {
                storePortalParams({ sonaId, episode });
            }

            if (options.cleanUrl !== false) {
                let changed = false;
                if (url.searchParams.has(PARAM_SONA_ID)) {
                    url.searchParams.delete(PARAM_SONA_ID);
                    changed = true;
                }
                if (url.searchParams.has(PARAM_EPISODE)) {
                    url.searchParams.delete(PARAM_EPISODE);
                    changed = true;
                }
                if (changed) {
                    const cleaned = `${url.pathname}${url.search}${url.hash}`;
                    global.history.replaceState({}, '', cleaned || url.pathname);
                }
            }

            return { sonaId, episode };
        } catch (error) {
            console.warn('[PortalParams] Failed to consume params:', error);
            return { sonaId: null, episode: null };
        }
    }

    function parseEpisodeFromUrl(locationRef) {
        try {
            const href = locationRef?.href || global.location.href;
            return parseEpisodeFromSearchParams(new URL(href).searchParams);
        } catch (error) {
            return null;
        }
    }

    function episodeToWeekId(episode) {
        const parsed = parseEpisodeValue(episode);
        return parsed ? `week${parsed}` : null;
    }

    function weekIdToEpisode(weekId) {
        const normalized = String(weekId || '').trim().toLowerCase();
        if (!normalized.startsWith('week')) {
            return null;
        }
        return parseEpisodeValue(normalized.slice(4));
    }

    function setEpisodeInUrl(episode, options = {}) {
        const parsed = parseEpisodeValue(episode);
        if (!parsed) {
            return;
        }
        try {
            storePortalParams({ episode: parsed });
            const url = new URL(global.location.href);
            url.searchParams.set(PARAM_EPISODE, String(parsed));
            const method = options.replace === false ? 'pushState' : 'replaceState';
            global.history[method]({}, '', `${url.pathname}${url.search}${url.hash}`);
        } catch (error) {
            console.warn('[PortalParams] Failed to update episode in URL:', error);
        }
    }

    function normalizeParticipantCode(code) {
        const raw = String(code || '').trim();
        if (!raw) {
            return '';
        }
        if (/^[1-9]\d{1,6}$/.test(raw)) {
            return raw;
        }
        return raw.toUpperCase();
    }

    global.portalParams = {
        PARAM_SONA_ID,
        PARAM_EPISODE,
        MIN_EPISODE,
        MAX_EPISODE,
        parseEpisodeValue,
        parseSonaIdValue,
        parseEpisodeFromUrl,
        parseEpisodeFromSearchParams,
        parseSonaIdFromSearchParams,
        getStoredSonaId,
        getStoredEpisode,
        storePortalParams,
        consumePortalParamsFromLocation,
        episodeToWeekId,
        weekIdToEpisode,
        setEpisodeInUrl,
        normalizeParticipantCode
    };
})(window);
