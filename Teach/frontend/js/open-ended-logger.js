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
    const TeachStateRef = (() => {
        if (global.TeachState) {
            return global.TeachState;
        }
        try {
            if (typeof TeachState !== 'undefined') {
                return TeachState;
            }
        } catch (error) {
            // Ignore lexical lookup errors in environments without TeachState.
        }
        return null;
    })();

    function shouldTrackInputField(inputField) {
        if (!inputField) {
            return false;
        }
        const tagName = String(inputField.tagName || '').toUpperCase();
        const isTextarea = tagName === 'TEXTAREA';
        const isTextInput = tagName === 'INPUT' && String(inputField.type || '').toLowerCase() === 'text';
        if (!isTextarea && !isTextInput) {
            return false;
        }
        if (inputField.id === 'teachNotesTextarea') {
            return false;
        }
        const cls = String(inputField.className || '');
        return (
            cls.includes('teach-') ||
            cls.includes('writing') ||
            cls.includes('sentence') ||
            cls.includes('before-reading') ||
            cls.includes('teach-blank-input')
        );
    }

    function inferPromptFromInputField(inputField) {
        const byFor = inputField.id
            ? document.querySelector(`label[for="${inputField.id}"]`)
            : null;
        if (byFor && byFor.textContent) {
            return byFor.textContent.trim();
        }
        const nearestLabel = inputField.closest('label');
        if (nearestLabel && nearestLabel.textContent) {
            return nearestLabel.textContent.trim();
        }
        return '';
    }

    function getSectionMeta(inputField) {
        const sectionMessage = inputField.closest('.teach-section-message');
        const className = String(inputField?.className || '');
        let writingSpace = '';
        if (className.includes('teach-blank-textarea-medium')) {
            writingSpace = 'medium';
        } else if (className.includes('teach-pick-explain-why-textarea')) {
            writingSpace = 'medium';
        } else if (className.includes('teach-blank-input')) {
            writingSpace = 'small';
        }
        return {
            sectionMessage,
            sectionId: sectionMessage?.dataset?.sectionId || 'unknown-section',
            renderer: sectionMessage?.dataset?.renderer || '',
            category: String(sectionMessage?.dataset?.sectionCategory || '').trim().toLowerCase(),
            writingSpace
        };
    }

    function getFeedbackContainer(inputField) {
        const sectionMeta = getSectionMeta(inputField);
        const parent = inputField.parentElement;
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

    function updateFeedback(inputField, feedbackText) {
        const feedbackEl = getFeedbackContainer(inputField);
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

    function getPassIndicatorContainer(inputField) {
        const parent = inputField?.parentElement;
        if (!parent) {
            return null;
        }
        let indicatorEl = parent.querySelector('.teach-exercise-pass-indicator');
        if (!indicatorEl) {
            indicatorEl = document.createElement('div');
            indicatorEl.className = 'teach-exercise-pass-indicator';
            indicatorEl.hidden = true;
            parent.appendChild(indicatorEl);
        }
        return indicatorEl;
    }

    function updatePassIndicator(inputField, status) {
        const indicatorEl = getPassIndicatorContainer(inputField);
        if (!indicatorEl) {
            return;
        }
        indicatorEl.classList.remove('pass', 'fail');
        if (status === 'passed') {
            indicatorEl.textContent = '✓ Exercise passed';
            indicatorEl.classList.add('pass');
            indicatorEl.hidden = false;
            return;
        }
        if (status === 'failed') {
            indicatorEl.textContent = '✗ Exercise not passed yet';
            indicatorEl.classList.add('fail');
            indicatorEl.hidden = false;
            return;
        }
        indicatorEl.textContent = '';
        indicatorEl.hidden = true;
    }

    function shouldEnableTutorFeedback(inputField) {
        const { category } = getSectionMeta(inputField);
        return category === 'writing';
    }

    function ensureFeedbackButton(inputField, getWeekId) {
        if (!shouldEnableTutorFeedback(inputField)) {
            return;
        }
        const parent = inputField.parentElement;
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
                await sendResponse(inputField, getWeekId, {
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

    async function sendResponse(inputField, getWeekId, options = {}) {
        if (!shouldTrackInputField(inputField)) {
            return;
        }

        const response = String(inputField.value || '').trim();
        if (!response) {
            return;
        }

        const trigger = String(options.trigger || '').trim();
        const forceFeedback = Boolean(options.forceFeedback);
        const showFeedback = Boolean(options.showFeedback);
        const forceTutorEvaluation = Boolean(options.forceTutorEvaluation);
        const { sectionId, renderer, category, writingSpace } = getSectionMeta(inputField);
        const weekId = typeof getWeekId === 'function' ? getWeekId() : '';
        const responseLength = response.length;
        if (category === 'writing' && responseLength < 20) {
            if (weekId && sectionId) {
                TeachStateRef?.setExerciseEvaluation?.(weekId, sectionId, {
                    status: 'pending_short',
                    source: 'short_response'
                });
            }
            updatePassIndicator(inputField, 'pending_short');
        }
        const includeFeedback = (
            forceFeedback
            || trigger === 'feedback_button'
            || trigger === 'continue'
        ) && (
            category === 'writing'
            && responseLength >= 20
            && (
                trigger === 'feedback_button'
                || 
                forceTutorEvaluation
                || lastFeedbackValue.get(inputField) !== response
            )
        );

        if (!includeFeedback && lastSentValue.get(inputField) === response) {
            return;
        }

        const token = TeachAuth?.getToken?.();
        if (!token) {
            return;
        }

        const prompt = inferPromptFromInputField(inputField);
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
                if (trigger === 'continue') {
                    console.warn('[TeachOpenEndedLogger] Continue evaluation response', {
                        sectionId,
                        weekId,
                        responseLength,
                        includeFeedback,
                        passed: data?.passed,
                        pass_reason: data?.pass_reason
                    });
                }
                lastSentValue.set(inputField, response);
                const hasPassedFlag = typeof data?.passed === 'boolean';
                const passed = data?.passed === true;
                const passReason = String(data?.pass_reason || '').trim().toLowerCase();
                const tutorEvaluatedByReason =
                    passReason === 'tutor_passed' || passReason === 'tutor_failed';
                const tutorEvaluatedByPayload =
                    hasPassedFlag && includeFeedback && responseLength >= 20;
                const tutorEvaluated = tutorEvaluatedByReason || tutorEvaluatedByPayload;
                if (weekId && sectionId && category === 'writing') {
                    if (tutorEvaluated) {
                        const resolvedStatus = passed ? 'passed' : 'failed';
                        TeachStateRef?.setExerciseEvaluation?.(weekId, sectionId, {
                            status: resolvedStatus,
                            source: 'tutor'
                        });
                        updatePassIndicator(inputField, resolvedStatus);
                        console.warn('[TeachOpenEndedLogger] Status applied', {
                            sectionId,
                            weekId,
                            status: resolvedStatus,
                            source: 'tutor'
                        });
                    } else if (responseLength < 20) {
                        updatePassIndicator(inputField, 'pending_short');
                        console.warn('[TeachOpenEndedLogger] Status skipped (too short)', {
                            sectionId,
                            weekId,
                            responseLength
                        });
                    }
                }
                if (includeFeedback) {
                    const feedbackText = String(data?.feedback || '').trim();
                    if (feedbackText && showFeedback) {
                        updateFeedback(inputField, feedbackText);
                    }
                    lastFeedbackValue.set(inputField, response);
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
        console.warn('[TeachOpenEndedLogger] Setup attached');

        const processSectionInputs = (sectionMessage) => {
            if (!sectionMessage) {
                return;
            }
            const inputs = sectionMessage.querySelectorAll('textarea, input[type="text"]');
            if (inputs.length > 0) {
                console.warn('[TeachOpenEndedLogger] Continue trigger captured', {
                    sectionId: sectionMessage?.dataset?.sectionId || '',
                    inputs: inputs.length
                });
            }
            inputs.forEach((inputField) => {
                if (!shouldTrackInputField(inputField)) {
                    return;
                }
                sendResponse(inputField, getWeekId, {
                    trigger: 'continue',
                    forceFeedback: true,
                    forceTutorEvaluation: true,
                    showFeedback: false
                });
            });
        };

        const knownInputs = container.querySelectorAll('textarea, input[type="text"]');
        knownInputs.forEach((inputField) => {
            if (shouldTrackInputField(inputField)) {
                ensureFeedbackButton(inputField, getWeekId);
            }
        });

        container.addEventListener('focusin', (event) => {
            const inputField = event.target;
            if (!shouldTrackInputField(inputField)) {
                return;
            }
            ensureFeedbackButton(inputField, getWeekId);
        });

        container.addEventListener('teach:section-continue', (event) => {
            const sectionMessage = event?.detail?.messageEl || event.target?.closest?.('.teach-section-message');
            processSectionInputs(sectionMessage);
        });
    }

    global.TeachOpenEndedLogger = {
        setup
    };
})(window);

