(function (global) {
    'use strict';

    const apiClient = global.apiClient;
    const TeachAuth = global.TeachAuth;

    if (!apiClient) {
        global.TeachOpenEndedLogger = null;
        return;
    }

    const pendingTimers = new WeakMap();
    const lastSentValue = new WeakMap();
    const DEBOUNCE_MS = 1200;

    function shouldTrackTextarea(textarea) {
        if (!textarea || textarea.tagName !== 'TEXTAREA') {
            return false;
        }
        if (textarea.id === 'teachNotesTextarea') {
            return false;
        }
        const cls = String(textarea.className || '');
        return (
            cls.includes('teach-') ||
            cls.includes('writing') ||
            cls.includes('sentence') ||
            cls.includes('before-reading')
        );
    }

    function inferPromptFromTextarea(textarea) {
        const byFor = textarea.id
            ? document.querySelector(`label[for="${textarea.id}"]`)
            : null;
        if (byFor && byFor.textContent) {
            return byFor.textContent.trim();
        }
        const nearestLabel = textarea.closest('label');
        if (nearestLabel && nearestLabel.textContent) {
            return nearestLabel.textContent.trim();
        }
        return '';
    }

    async function sendResponse(textarea, getWeekId) {
        if (!shouldTrackTextarea(textarea)) {
            return;
        }

        const response = String(textarea.value || '').trim();
        if (!response) {
            return;
        }

        if (lastSentValue.get(textarea) === response) {
            return;
        }

        const token = TeachAuth?.getToken?.();
        if (!token) {
            return;
        }

        const sectionMessage = textarea.closest('.teach-section-message');
        const sectionId = sectionMessage?.dataset?.sectionId || 'unknown-section';
        const renderer = sectionMessage?.dataset?.renderer || '';
        const prompt = inferPromptFromTextarea(textarea);
        const weekId = typeof getWeekId === 'function' ? getWeekId() : '';

        try {
            const { response: apiResponse } = await apiClient.postJson(
                '/api/teach/open-ended-response',
                {
                    section_id: sectionId,
                    prompt,
                    response,
                    week_id: weekId || null,
                    renderer: renderer || null
                },
                { token }
            );

            if (apiResponse.ok) {
                lastSentValue.set(textarea, response);
            }
        } catch (error) {
            console.warn('[TeachOpenEndedLogger] Failed to save open-ended response:', error);
        }
    }

    function scheduleSend(textarea, getWeekId) {
        const existing = pendingTimers.get(textarea);
        if (existing) {
            clearTimeout(existing);
        }
        const timer = setTimeout(() => {
            pendingTimers.delete(textarea);
            sendResponse(textarea, getWeekId);
        }, DEBOUNCE_MS);
        pendingTimers.set(textarea, timer);
    }

    function setup(container, getWeekId) {
        if (!container || typeof container.addEventListener !== 'function') {
            return;
        }

        container.addEventListener('input', (event) => {
            const textarea = event.target;
            if (!shouldTrackTextarea(textarea)) {
                return;
            }
            scheduleSend(textarea, getWeekId);
        });

        container.addEventListener('focusout', (event) => {
            const textarea = event.target;
            if (!shouldTrackTextarea(textarea)) {
                return;
            }
            const existing = pendingTimers.get(textarea);
            if (existing) {
                clearTimeout(existing);
                pendingTimers.delete(textarea);
            }
            sendResponse(textarea, getWeekId);
        });
    }

    global.TeachOpenEndedLogger = {
        setup
    };
})(window);

