(function (global) {
    'use strict';

    const uiShared = global.uiShared || {};
    const apiClient = global.apiClient;
    const explainClient = global.explainClient;

    if (
        !apiClient
        || !explainClient
        || typeof explainClient.requestWordExplanation !== 'function'
        || typeof explainClient.createWordExplainHandler !== 'function'
    ) {
        console.warn('[TeachExplain] explain dependencies are not available. Word explanations will be disabled.');
        return;
    }

    const TeachAuth = global.TeachAuth;
    const addMessage = typeof uiShared.addMessage === 'function'
        ? uiShared.addMessage
        : null;
    const showTypingIndicator = typeof uiShared.showTypingIndicator === 'function'
        ? uiShared.showTypingIndicator
        : null;

    const tutorProfile = {
        sender: 'AI Tutor'
    };

    const explainErrorMessage = explainClient.DEFAULT_EXPLAIN_ERROR_MESSAGE || 'Could not fetch the explanation. Please try again later.';

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
            null,
            false,
            { hideAvatar: true }
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
        return explainClient.requestWordExplanation({
            apiClient,
            word,
            originalText,
            source: 'teach',
            getToken: () => TeachAuth?.getToken?.() || '',
            requestWithRecovery: (requestFn) => TeachAuth?.callWithSessionRecovery?.(requestFn, {
                authFailureMessage: explainErrorMessage
            }) || requestFn()
        });
    }

    function handleExplainError(error) {
        console.error('[TeachExplain] Failed to fetch explanation:', error);
        if (addMessage) {
            addMessage(
                'system',
                'Tutor',
                explainErrorMessage
            );
        }
    }

    const explainWord = explainClient.createWordExplainHandler({
        fetchExplanation,
        onDeliver: deliverExplanation,
        onError: handleExplainError,
        showTypingIndicator,
        getTypingName: () => tutorProfile.sender
    });

    global.explainWord = explainWord;
})(window);


