// Demo colleague mode for Tell (DEMO login → DEMO1, DEMO2, …)
(function (global) {
    'use strict';

    const TELL_DEMO_ONBOARDING_INTRO = [
        'Hi! 👋',
        'Welcome to the Tell demo.',
        '',
        'Explore the detective story, talk to characters, and try the language-learning features.',
    ].join('\n');

    const TELL_DEMO_SURVEY_FOLD_LABEL = 'Study questionnaires (not required for demo)';

    const TELL_DEMO_OUTRO_TEXT = [
        'Thanks for playing!',
        '',
        'You can keep exploring the next episode whenever you like.',
    ].join('\n');

    function normalizeCode(code) {
        return String(code || '')
            .trim()
            .toUpperCase();
    }

    function getParticipantCode() {
        return normalizeCode(global.participantCode || global.localStorage?.getItem('participantCode') || '');
    }

    function isDemoSlotCode(code) {
        return /^DEMO\d+$/i.test(normalizeCode(code));
    }

    function isDemoMode() {
        return isDemoSlotCode(getParticipantCode());
    }

    function buildLoginPayload(rawCode) {
        const participantCode = normalizeCode(rawCode);
        const payload = { participant_code: participantCode };
        if (participantCode === 'DEMO') {
            const stored = getParticipantCode();
            if (isDemoSlotCode(stored)) {
                payload.demo_slot = stored;
            }
        }
        return payload;
    }

    function isOnboardingWelcomeMessage(msg) {
        const buttons = Array.isArray(msg?.buttons) ? msg.buttons : [];
        return (
            msg?.type === 'system' &&
            buttons.some((btn) => btn?.action === 'onboarding_step5')
        );
    }

    function isStudyQuestionnaireOutro(content) {
        const text = String(content || '');
        return (
            /questionnaire/i.test(text) &&
            (/forms\.gle|docs\.google\.com\/forms|QUESTIONNAIRE_LINK|NEXT_EPISODE_CALENDAR/i.test(text))
        );
    }

    function renderMarkdownInto(element, markdownText) {
        if (!element) {
            return;
        }
        const render = global.uiShared?.renderMarkdown;
        const text = String(markdownText || '').trim();
        if (render) {
            element.innerHTML = render(text);
        } else {
            element.textContent = text;
        }
    }

    function applyDemoOnboardingFold(messageDiv, studyContent) {
        const messageText = messageDiv?.querySelector('.message-text');
        if (!messageText) {
            return;
        }

        renderMarkdownInto(messageText, TELL_DEMO_ONBOARDING_INTRO);

        const details = document.createElement('details');
        details.className = 'tell-demo-survey-fold';

        const summary = document.createElement('summary');
        summary.textContent = TELL_DEMO_SURVEY_FOLD_LABEL;
        details.appendChild(summary);

        const studyBody = document.createElement('div');
        studyBody.className = 'tell-demo-survey-fold-body';
        renderMarkdownInto(studyBody, studyContent);
        details.appendChild(studyBody);
        messageText.appendChild(details);
    }

    function applyDemoOutroReplacement(messageDiv) {
        const messageText = messageDiv?.querySelector('.message-text');
        if (!messageText) {
            return;
        }
        renderMarkdownInto(messageText, TELL_DEMO_OUTRO_TEXT);
    }

    function applyDemoMessagePresentation(messageDiv, msg) {
        if (!messageDiv || !msg || !isDemoMode()) {
            return;
        }

        if (isOnboardingWelcomeMessage(msg)) {
            applyDemoOnboardingFold(messageDiv, msg.content);
            messageDiv.classList.add('tell-demo-onboarding');
            return;
        }

        if (isStudyQuestionnaireOutro(msg.content)) {
            applyDemoOutroReplacement(messageDiv);
            messageDiv.classList.add('tell-demo-outro');
        }
    }

    global.tellDemoMode = {
        isDemoMode,
        buildLoginPayload,
        applyDemoMessagePresentation,
    };
})(window);
