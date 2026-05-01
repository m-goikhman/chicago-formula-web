(function (global) {
    'use strict';

    const DEFAULT_EXPLAIN_ERROR_MESSAGE = 'Could not fetch the explanation. Please try again later.';

    function normaliseOriginalText(text) {
        if (!text) {
            return '';
        }
        return String(text).replace(/\s+/g, ' ').trim();
    }

    function createError(code, message) {
        const error = new Error(message);
        error.code = code;
        return error;
    }

    function extractTutorBody(messages) {
        const firstMessage = Array.isArray(messages) ? messages[0] : null;
        if (!firstMessage) {
            return '';
        }

        const raw = String(firstMessage.content || '').trim();
        if (!raw) {
            return '';
        }

        const parts = raw.split('\n').map((line) => line.trim());
        if (parts.length && /:\*$/.test(parts[0])) {
            parts.shift();
        } else if (parts.length && parts[0].includes(':')) {
            parts.shift();
        }

        return parts.join('\n').trim() || raw;
    }

    async function requestWordExplanationResponse(options = {}) {
        const {
            apiClient,
            word,
            originalText = '',
            source = '',
            getToken,
            requestWithRecovery
        } = options;

        if (!apiClient || typeof apiClient.postJson !== 'function') {
            throw createError('invalid_client', 'apiClient is not available');
        }

        const normalizedWord = String(word || '').trim();
        if (!normalizedWord) {
            throw createError('invalid_input', 'Word is required');
        }

        const payload = {
            action: 'word',
            word: normalizedWord,
            original_text: normaliseOriginalText(originalText)
        };

        if (source) {
            payload.source = source;
        }

        const executeRequest = async () => apiClient.postJson('/api/game/explain', payload, {
            token: typeof getToken === 'function' ? getToken() : ''
        });

        const requestResult = typeof requestWithRecovery === 'function'
            ? await requestWithRecovery(executeRequest)
            : await executeRequest();

        const { response, data, authFailureHandled } = requestResult || {};
        return { response, data, authFailureHandled };
    }

    async function requestWordExplanation(options = {}) {
        const { response, data, authFailureHandled } = await requestWordExplanationResponse(options);
        if (authFailureHandled) {
            throw createError('missing_token', 'Session token missing');
        }
        if (!response?.ok) {
            const detail = data && (data.detail || data.error || data.message);
            const requestError = createError('explain_failed', detail || DEFAULT_EXPLAIN_ERROR_MESSAGE);
            requestError.httpStatus = response?.status;
            throw requestError;
        }
        return extractTutorBody(data?.messages);
    }

    function createWordExplainHandler(options = {}) {
        const {
            fetchExplanation,
            onDeliver,
            onError,
            showTypingIndicator,
            getTypingName,
            useCache = true,
            buildCacheKey = (word, originalText) => `${String(word || '').toLowerCase()}::${String(originalText || '')}`
        } = options;

        if (typeof fetchExplanation !== 'function') {
            throw createError('invalid_config', 'fetchExplanation must be a function');
        }
        if (typeof onDeliver !== 'function') {
            throw createError('invalid_config', 'onDeliver must be a function');
        }

        const explanationCache = new Map();

        return async function explainWord(wordOrPhrase, originalText = '') {
            const word = String(wordOrPhrase || '').trim();
            if (!word) {
                return;
            }

            const cacheKey = buildCacheKey(word, originalText);
            if (useCache && explanationCache.has(cacheKey)) {
                onDeliver(word, explanationCache.get(cacheKey));
                return;
            }

            let typingMessage = null;
            if (typeof showTypingIndicator === 'function') {
                typingMessage = showTypingIndicator({
                    name: typeof getTypingName === 'function' ? getTypingName() : undefined
                });
            }

            try {
                const explanationMarkdown = await fetchExplanation(word, originalText);
                if (useCache) {
                    explanationCache.set(cacheKey, explanationMarkdown);
                }
                onDeliver(word, explanationMarkdown);
            } catch (error) {
                if (typeof onError === 'function') {
                    onError(error, word, originalText);
                } else {
                    throw error;
                }
            } finally {
                if (typingMessage && typeof typingMessage.remove === 'function') {
                    typingMessage.remove();
                }
            }
        };
    }

    global.explainClient = global.explainClient || {
        DEFAULT_EXPLAIN_ERROR_MESSAGE,
        requestWordExplanationResponse,
        requestWordExplanation,
        createWordExplainHandler
    };
})(window);
