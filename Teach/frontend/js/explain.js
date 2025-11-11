(function (global) {
    'use strict';

    const uiShared = global.uiShared || {};
    const apiClient = global.apiClient;

    if (!apiClient) {
        console.warn('[TeachExplain] apiClient is not available. Word explanations will be disabled.');
        return;
    }

    const addMessage = typeof uiShared.addMessage === 'function'
        ? uiShared.addMessage
        : null;
    const showTypingIndicator = typeof uiShared.showTypingIndicator === 'function'
        ? uiShared.showTypingIndicator
        : null;

    const tutorProfile = {
        sender: 'AI Tutor',
        avatar: 'detective_guide.png'
    };

    const explanationCache = new Map();

    const STORAGE_KEYS = {
        token: 'sessionToken',
        participantCode: 'participantCode'
    };

    let sessionRefreshPromise = null;
    let participantPromptShown = false;

    function buildCacheKey(word, originalText) {
        return `${word.toLowerCase()}::${originalText ?? ''}`;
    }

    function createError(code, message) {
        const error = new Error(message);
        error.code = code;
        return error;
    }

    function readStoredValue(key) {
        try {
            return global.localStorage?.getItem(key) || '';
        } catch (error) {
            console.warn('[TeachExplain] Unable to access localStorage:', error);
            return '';
        }
    }

    function writeStoredValue(key, value) {
        try {
            if (!global.localStorage) {
                return;
            }
            if (value == null) {
                global.localStorage.removeItem(key);
            } else {
                global.localStorage.setItem(key, value);
            }
        } catch (error) {
            console.warn('[TeachExplain] Unable to write to localStorage:', error);
        }
    }

    function readStoredToken() {
        return readStoredValue(STORAGE_KEYS.token);
    }

    function readStoredParticipantCode() {
        return readStoredValue(STORAGE_KEYS.participantCode);
    }

    function persistSession(token, participantCode) {
        if (token) {
            writeStoredValue(STORAGE_KEYS.token, token);
        }
        if (participantCode) {
            writeStoredValue(STORAGE_KEYS.participantCode, participantCode.toUpperCase());
        }
    }

    function notifyMissingParticipantCode() {
        if (participantPromptShown) {
            return;
        }
        participantPromptShown = true;

        if (addMessage) {
            addMessage(
                'system',
                'Mentor',
                'To unlock word explanations, sign in with your participant code on the Teach login screen, then try again.'
            );
        }
    }

    async function ensureParticipantCode() {
        const stored = readStoredParticipantCode();
        if (stored) {
            return stored;
        }

        notifyMissingParticipantCode();

        if (typeof global.prompt === 'function') {
            const result = global.prompt('Enter your participant code (e.g., ABC123):', '');
            const normalized = result ? result.trim().toUpperCase() : '';
            if (normalized) {
                writeStoredValue(STORAGE_KEYS.participantCode, normalized);
                participantPromptShown = false; // allow future notifications if needed
                return normalized;
            }
        }

        throw createError('missing_token', 'Participant code is not available');
    }

    async function refreshSessionToken() {
        if (!sessionRefreshPromise) {
            sessionRefreshPromise = (async () => {
                const participantCode = await ensureParticipantCode();

                const normalizedCode = participantCode.trim().toUpperCase();
                const { response, data } = await apiClient.postJson('/api/auth/login', {
                    participant_code: normalizedCode
                });

                if (!response.ok) {
                    const detail = data && (data.detail || data.error || data.message);
                    throw createError('login_failed', detail || 'Could not refresh session token');
                }

                const token = data?.token;
                if (!token) {
                    throw createError('login_failed', 'Login response did not include a session token');
                }

                persistSession(token, data?.participant_code || normalizedCode);
                return token;
            })();
        }

        try {
            return await sessionRefreshPromise;
        } finally {
            sessionRefreshPromise = null;
        }
    }

    async function ensureSessionToken(forceRefresh = false) {
        if (!forceRefresh) {
            const stored = readStoredToken();
            if (stored) {
                return stored;
            }
        }
        return refreshSessionToken();
    }

    function extractTutorBody(message) {
        if (!message) {
            return '';
        }
        const raw = (message.content || '').trim();
        if (!raw) {
            return '';
        }

        const parts = raw.split('\n').map(line => line.trim());
        if (parts.length && /:\*$/.test(parts[0])) {
            parts.shift();
        } else if (parts.length && parts[0].includes(':')) {
            parts.shift();
        }

        return parts.join('\n').trim() || raw;
    }

    function normaliseOriginalText(text) {
        if (!text) {
            return '';
        }
        return String(text).replace(/\s+/g, ' ').trim();
    }

    function deliverExplanation(word, explanationMarkdown) {
        if (!addMessage) {
            console.warn('[TeachExplain] addMessage is not available. Explanation:', explanationMarkdown);
            return;
        }

        const contentLines = [];
        contentLines.push(`**${word}**`);

        if (explanationMarkdown) {
            contentLines.push('');
            contentLines.push(explanationMarkdown);
        } else {
            contentLines.push('');
            contentLines.push('Sorry, I could not find an explanation for this word yet.');
        }

        const messageDiv = addMessage(
            'bot',
            tutorProfile.sender,
            contentLines.join('\n'),
            null,
            tutorProfile.avatar
        );

        if (!messageDiv) {
            return;
        }

        messageDiv.classList.add('tutor-message');

        const messageContent = messageDiv.querySelector('.message-content');
        if (messageContent) {
            const buttonRow = document.createElement('div');
            buttonRow.className = 'button-row';

            const hideButton = document.createElement('button');
            hideButton.type = 'button';
            hideButton.textContent = 'Hide this message';
            hideButton.addEventListener('click', () => {
                messageDiv.style.display = 'none';
            });

            buttonRow.appendChild(hideButton);
            messageContent.appendChild(buttonRow);
        }
    }

    async function fetchExplanation(word, originalText) {
        const payload = {
            action: 'word',
            word,
            original_text: normaliseOriginalText(originalText)
        };

        let token;
        try {
            token = await ensureSessionToken();
        } catch (error) {
            throw error.code ? error : createError('missing_token', error.message || 'Session token missing');
        }

        const executeRequest = async (tokenValue) => apiClient.postJson('/api/game/explain', payload, {
            token: tokenValue
        });

        let response;
        let data;
        let requestError;

        ({ response, data } = await executeRequest(token));

        if (response.status === 401) {
            try {
                token = await ensureSessionToken(true);
            } catch (error) {
                throw error.code ? error : createError('missing_token', 'Session expired');
            }
            ({ response, data } = await executeRequest(token));
        }

        if (!response.ok) {
            const detail = data && (data.detail || data.error || data.message);
            requestError = createError('explain_failed', detail || 'Failed to get explanation');
            requestError.httpStatus = response.status;
            throw requestError;
        }

        const firstMessage = Array.isArray(data?.messages) ? data.messages[0] : null;
        return extractTutorBody(firstMessage);
    }

    async function explainWord(wordOrPhrase, originalText = '') {
        const word = (wordOrPhrase || '').trim();
        if (!word) {
            return;
        }

        const cacheKey = buildCacheKey(word, originalText);
        if (explanationCache.has(cacheKey)) {
            deliverExplanation(word, explanationCache.get(cacheKey));
            return;
        }

        let typingMessage = null;

        if (showTypingIndicator) {
            typingMessage = showTypingIndicator({
                name: tutorProfile.sender,
                image: tutorProfile.avatar
            });
        }

        try {
            const explanationMarkdown = await fetchExplanation(word, originalText);
            explanationCache.set(cacheKey, explanationMarkdown);
            deliverExplanation(word, explanationMarkdown);
        } catch (error) {
            console.error('[TeachExplain] Failed to fetch explanation:', error);
            if (addMessage) {
                if (error.code === 'missing_token') {
                    addMessage(
                        'system',
                        'Mentor',
                            'Sign in with your participant code on the Teach login screen, then return to unlock explanations.'
                    );
                } else {
                    addMessage(
                        'system',
                        'Mentor',
                        'Could not fetch the explanation. Please try again later.'
                    );
                }
            }
        } finally {
            if (typingMessage && typeof typingMessage.remove === 'function') {
                typingMessage.remove();
            }
        }
    }

    global.explainWord = explainWord;
})(window);


