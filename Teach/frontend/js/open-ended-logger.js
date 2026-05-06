(function (global) {
    'use strict';

    const apiClient = global.apiClient;
    const TeachAuth = global.TeachAuth;

    if (!apiClient) {
        global.TeachOpenEndedLogger = null;
        return;
    }

    const lastSentValue = new WeakMap();
    const lastFeedbackValue = new WeakMap();

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

    function getSectionMeta(textarea) {
        const sectionMessage = textarea.closest('.teach-section-message');
        const className = String(textarea?.className || '');
        let writingSpace = '';
        if (className.includes('teach-blank-textarea-huge')) {
            writingSpace = 'huge';
        } else if (className.includes('teach-blank-textarea-medium')) {
            writingSpace = 'medium';
        } else if (className.includes('teach-pick-explain-why-textarea')) {
            writingSpace = 'medium';
        }
        return {
            sectionMessage,
            sectionId: sectionMessage?.dataset?.sectionId || 'unknown-section',
            renderer: sectionMessage?.dataset?.renderer || '',
            category: String(sectionMessage?.dataset?.sectionCategory || '').trim().toLowerCase(),
            writingSpace
        };
    }

    function getFeedbackContainer(textarea) {
        const sectionMeta = getSectionMeta(textarea);
        const parent = textarea.parentElement;
        if (!parent || !sectionMeta.sectionMessage) {
            return null;
        }

        let feedbackEl = parent.querySelector('.teach-inline-tutor-feedback');
        if (!feedbackEl) {
            feedbackEl = document.createElement('div');
            feedbackEl.className = 'teach-inline-tutor-feedback';
            feedbackEl.hidden = true;
            parent.appendChild(feedbackEl);
        }
        return feedbackEl;
    }

    function updateFeedback(textarea, feedbackText) {
        const feedbackEl = getFeedbackContainer(textarea);
        if (!feedbackEl) {
            return;
        }

        const text = String(feedbackText || '').trim();
        if (!text) {
            feedbackEl.textContent = '';
            feedbackEl.hidden = true;
            return;
        }

        feedbackEl.textContent = `Tutor feedback: ${text}`;
        feedbackEl.hidden = false;
    }

    function shouldEnableTutorFeedback(textarea) {
        const { category } = getSectionMeta(textarea);
        return category === 'writing';
    }

    function ensureFeedbackButton(textarea, getWeekId) {
        if (!shouldEnableTutorFeedback(textarea)) {
            return;
        }
        const parent = textarea.parentElement;
        if (!parent) {
            return;
        }
        if (parent.querySelector('.teach-get-tutor-feedback-btn')) {
            return;
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'teach-get-tutor-feedback-btn';
        button.textContent = 'Get tutor feedback';
        button.addEventListener('click', async () => {
            if (button.disabled) {
                return;
            }
            button.disabled = true;
            try {
                await sendResponse(textarea, getWeekId, {
                    trigger: 'feedback_button',
                    forceFeedback: true,
                    showFeedback: true
                });
            } finally {
                button.disabled = false;
            }
        });

        parent.appendChild(button);
    }

    async function sendResponse(textarea, getWeekId, options = {}) {
        if (!shouldTrackTextarea(textarea)) {
            return;
        }

        const response = String(textarea.value || '').trim();
        if (!response) {
            return;
        }

        const trigger = String(options.trigger || '').trim();
        const forceFeedback = Boolean(options.forceFeedback);
        const showFeedback = Boolean(options.showFeedback);
        const { sectionId, renderer, category, writingSpace } = getSectionMeta(textarea);
        const includeFeedback = (
            forceFeedback
            || trigger === 'feedback_button'
            || trigger === 'continue'
        ) && (
            category === 'writing'
            && response.length >= 20
            && lastFeedbackValue.get(textarea) !== response
        );

        if (!includeFeedback && lastSentValue.get(textarea) === response) {
            return;
        }

        const token = TeachAuth?.getToken?.();
        if (!token) {
            return;
        }

        const prompt = inferPromptFromTextarea(textarea);
        const weekId = typeof getWeekId === 'function' ? getWeekId() : '';

        try {
            const { response: apiResponse, data } = await apiClient.postJson(
                '/api/teach/open-ended-response',
                {
                    section_id: sectionId,
                    prompt,
                    response,
                    week_id: weekId || null,
                    renderer: renderer || null,
                    category: category || null,
                    writing_space: writingSpace || null,
                    include_feedback: includeFeedback
                },
                { token }
            );

            if (apiResponse.ok) {
                lastSentValue.set(textarea, response);
                if (includeFeedback) {
                    const feedbackText = String(data?.feedback || '').trim();
                    if (feedbackText && showFeedback) {
                        updateFeedback(textarea, feedbackText);
                    }
                    lastFeedbackValue.set(textarea, response);
                }
            }
        } catch (error) {
            console.warn('[TeachOpenEndedLogger] Failed to save open-ended response:', error);
        }
    }

    function setup(container, getWeekId) {
        if (!container || typeof container.addEventListener !== 'function') {
            return;
        }

        const knownTextareas = container.querySelectorAll('textarea');
        knownTextareas.forEach((textarea) => {
            if (shouldTrackTextarea(textarea)) {
                ensureFeedbackButton(textarea, getWeekId);
            }
        });

        container.addEventListener('focusin', (event) => {
            const textarea = event.target;
            if (!shouldTrackTextarea(textarea)) {
                return;
            }
            ensureFeedbackButton(textarea, getWeekId);
        });

        container.addEventListener('click', (event) => {
            const continueBtn = event.target?.closest('.teach-next-button, .teach-sentence-send.continue');
            if (!continueBtn) {
                return;
            }
            const sectionMessage = continueBtn.closest('.teach-section-message');
            if (!sectionMessage) {
                return;
            }
            const textareas = sectionMessage.querySelectorAll('textarea');
            textareas.forEach((textarea) => {
                if (!shouldTrackTextarea(textarea)) {
                    return;
                }
                sendResponse(textarea, getWeekId, {
                    trigger: 'continue',
                    forceFeedback: true,
                    showFeedback: false
                });
            });
        });
    }

    global.TeachOpenEndedLogger = {
        setup
    };
})(window);

