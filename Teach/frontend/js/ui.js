const TeachUI = (() => {
    const shared = window.uiShared;
    if (!shared) {
        throw new Error('uiShared must be loaded before Teach UI');
    }

    const { addMessage } = shared;
    const {
        TEACH_ONBOARDING_WELCOME_TEMPLATE,
        ONBOARDING_QUESTIONNAIRE_TEMPLATE_LINK,
        ONBOARDING_QUESTIONNAIRE_FALLBACK_STATIC_LINK,
        ONBOARDING_QUESTIONNAIRE_FORM_VIEW_URL,
        ONBOARDING_QUESTIONNAIRE_PARTICIPANT_ENTRY
    } = window.TEACH_CONFIG || {};
    const stepProgressByWeek = new Map();

    function buildOnboardingQuestionnaireLink(participantCode = '') {
        const normalizedCode = String(participantCode || '').trim().toUpperCase();
        if (!normalizedCode || !ONBOARDING_QUESTIONNAIRE_PARTICIPANT_ENTRY || !ONBOARDING_QUESTIONNAIRE_FORM_VIEW_URL) {
            return ONBOARDING_QUESTIONNAIRE_FALLBACK_STATIC_LINK;
        }

        const params = new URLSearchParams({
            usp: 'pp_url',
            [`entry.${ONBOARDING_QUESTIONNAIRE_PARTICIPANT_ENTRY}`]: normalizedCode
        });
        return `${ONBOARDING_QUESTIONNAIRE_FORM_VIEW_URL}?${params.toString()}`;
    }

    function personalizeOnboardingQuestionnaireLink(text, participantCode = '') {
        if (!text) {
            return text;
        }
        const personalizedLink = buildOnboardingQuestionnaireLink(participantCode);
        let result = String(text);
        result = result.replace(ONBOARDING_QUESTIONNAIRE_TEMPLATE_LINK, personalizedLink);
        result = result.replace(ONBOARDING_QUESTIONNAIRE_FALLBACK_STATIC_LINK, personalizedLink);
        result = result.replace(
            /https:\/\/docs\.google\.com\/forms\/d\/e\/1FAIpQLSdE5BiT1SLKPhP2dH1L-kus0oey4857psewaZz6rA8o_c469g\/viewform(?:\?[^\s)]*)?/g,
            personalizedLink
        );
        return result;
    }

    const parseAnswerKey =
        window.TeachAnswerKey?.parseAnswerKey ??
        (() => ({}));
    const getAnswersForExercise =
        window.TeachAnswerKey?.getAnswersForExercise ??
        (() => null);

    function appendNextButton(messageEl, onClick, label = 'Continue') {
        if (!messageEl) {
            return;
        }

        const content = messageEl.querySelector('.message-content');
        if (!content) {
            return;
        }

        const actions = document.createElement('div');
        actions.className = 'teach-message-actions';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'teach-next-button';
        button.textContent = label;

        button.addEventListener('click', () => {
            button.disabled = true;
            actions.remove();
            if (typeof onClick === 'function') {
                onClick();
            }
        });

        actions.appendChild(button);
        content.appendChild(actions);
    }

    const resolveFullscreenImageUrl =
        window.TeachImageModal?.resolveFullscreenImageUrl ??
        ((imageUrl) => imageUrl);
    const openImageModal =
        window.TeachImageModal?.openImageModal ??
        (() => {});
    const closeImageModal =
        window.TeachImageModal?.closeImageModal ??
        (() => {});

    function resolveMessageElement(result) {
        if (!result) {
            return null;
        }
        if (result instanceof HTMLElement) {
            return result;
        }
        if (result.messageEl instanceof HTMLElement) {
            return result.messageEl;
        }
        return null;
    }

    function getSectionHeadingInfo(section) {
        const heading = typeof section?.heading === 'string' ? section.heading.trim() : '';
        const kind = typeof section?.kind === 'string' ? section.kind.trim().toLowerCase() : '';
        const category = typeof section?.category === 'string' ? section.category.trim().toLowerCase() : '';
        
        // Exclude vocabulary sections from typewriter styling
        const normalizedHeading = heading.toLowerCase();
        const isVocabularySection = /vocabulary/i.test(normalizedHeading);
        
        // Manifest is the source of truth: prefer explicit kind/category metadata.
        // Keep a narrow fallback for older content that only used type='reading'.
        const hasHeading = heading && heading.length > 0;
        const isExplicitStory = kind === 'story' || category === 'story';
        
        const isStorySection =
            !isVocabularySection &&
            hasHeading &&
            (isExplicitStory || section?.type === 'reading');

        const displayHeading = (() => {
            if (!heading) {
                return '';
            }
            if (!isStorySection) {
                return heading;
            }
            // Extract title after colon if present (e.g., "Reading Text: The Attack" -> "The Attack")
            const match = heading.match(/:(.*)$/);
            return (match ? match[1] : heading).trim();
        })();

        return { heading, displayHeading, isStorySection };
    }

    function isBeforeReadingSection(section) {
        const heading = typeof section?.heading === 'string' ? section.heading : '';
        const id = typeof section?.id === 'string' ? section.id : '';
        return /before\s*reading/i.test(heading) || /before-reading/i.test(id);
    }

    const resolveBeforeReadingImageSrc =
        window.TeachImageModal?.resolveBeforeReadingImageSrc ??
        (() => []);

    function normaliseHeading(text) {
        if (!text) {
            return '';
        }
        return String(text)
            .replace(/[*_`]/g, '')
            .replace(/["“”]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function truncateHeading(text, maxLength = 70) {
        if (!text || text.length <= maxLength) {
            return text;
        }
        return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
    }

    function buildNextButtonLabel(stepType, context = {}) {
        return 'Continue';
    }

    function closeMenu() {
        const menu = document.getElementById('horizontalMenu');
        const button = document.getElementById('burgerButton');
        if (!menu || !button) {
            return;
        }
        menu.classList.remove('active');
        button.classList.remove('active');
        if (!menu.dataset.userToggled) {
            menu.dataset.userToggled = 'true';
        }
    }

    function toggleMenu() {
        const menu = document.getElementById('horizontalMenu');
        const button = document.getElementById('burgerButton');
        if (!menu || !button) {
            return;
        }
        const isActive = menu.classList.toggle('active');
        button.classList.toggle('active', isActive);
        menu.dataset.userToggled = 'true';
    }

    const getWeekEpisodeMeta =
        window.TeachWeekSelector?.getWeekEpisodeMeta ??
        ((week, index) => ({
            number: index + 1,
            title: String(week?.title || '').trim() || `Week ${index + 1}`
        }));
    const closeWeekSelectorDropdown =
        window.TeachWeekSelector?.closeWeekSelectorDropdown ??
        (() => {});
    const renderWeekSelector =
        window.TeachWeekSelector?.renderWeekSelector ??
        (() => {});

    function setChatLoading(chatArea, message = 'Loading your weekly materials…') {
        if (!chatArea) {
            return;
        }
        chatArea.innerHTML = '';
        addMessage('bot', 'Mentor', message);
    }

    function createCategoryBadge(category) {
        if (!category) {
            return null;
        }
        const badge = document.createElement('span');
        badge.className = 'teach-task-badge';
        badge.textContent = category.replace(/^\w/, (c) => c.toUpperCase());
        return badge;
    }

    function attachTaskControls(messageEl, section, options = {}) {
        if (!messageEl) {
            return;
        }

        const isCompleted = options.isTaskCompleted?.(section.id) ?? false;
        if (isCompleted) {
            messageEl.classList.add('teach-task-message-completed');
        }

        const content = messageEl.querySelector('.message-content');
        if (!content) {
            return;
        }

        const controls = document.createElement('div');
        controls.className = 'teach-task-controls';

        const left = document.createElement('div');
        left.className = 'teach-task-controls-left';

        const heading = document.createElement('div');
        heading.className = 'teach-task-label';
        heading.textContent = 'Task status';

        if (section.category) {
            const badge = createCategoryBadge(section.category);
            if (badge) {
                left.appendChild(badge);
            }
        }

        left.appendChild(heading);

        const right = document.createElement('label');
        right.className = 'teach-task-toggle';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = isCompleted;
        checkbox.setAttribute('aria-label', `Mark "${section.heading}" as complete`);

        const faux = document.createElement('span');
        faux.className = 'teach-task-toggle-indicator';

        const state = document.createElement('span');
        state.className = 'teach-task-toggle-text';
        state.textContent = isCompleted ? 'Completed' : 'Mark complete';

        right.appendChild(checkbox);
        right.appendChild(faux);
        right.appendChild(state);

        checkbox.addEventListener('change', (event) => {
            const checked = event.target.checked;
            state.textContent = checked ? 'Completed' : 'Mark complete';
            messageEl.classList.toggle('teach-task-message-completed', checked);
            options.onTaskToggle?.(section.id, checked);
        });

        controls.appendChild(left);
        controls.appendChild(right);
        content.appendChild(controls);
    }

    const renderMatchWordsExercise =
        window.TeachMatchWords?.renderMatchWordsExercise ??
        (() => {});

    const renderSentenceExercise =
        window.TeachSentenceBuilder?.renderSentenceExercise ??
        (() => {});

    const renderSuspectsDragExercise =
        window.TeachSuspectsDrag?.renderSuspectsDragExercise ??
        (() => {});

    const renderFillInTheBlanksExercise =
        window.TeachFillInTheBlanks?.renderFillInTheBlanksExercise ??
        (() => {});

    const renderPickExplainExercise =
        window.TeachPickExplain?.renderPickExplainExercise ??
        (() => {});

    const apiClient = window.apiClient;
    const TeachAuth = window.TeachAuth;

    async function requestTutorFinalSummary() {
        if (!apiClient || !TeachAuth || typeof TeachAuth.callWithSessionRecovery !== 'function') {
            throw new Error('Tutor summary is unavailable right now.');
        }

        const executeRequest = async () => apiClient.get('/api/teach/final-summary', {
            token: TeachAuth.getToken?.() || ''
        });

        const { response, data, authFailureHandled } = await TeachAuth.callWithSessionRecovery(executeRequest, {
            authFailureMessage: 'Could not fetch tutor summary right now.'
        });

        if (authFailureHandled) {
            throw new Error('Could not fetch tutor summary right now.');
        }
        if (!response?.ok) {
            const detail = data && (data.detail || data.error || data.message);
            throw new Error(detail || 'Could not fetch tutor summary right now.');
        }

        const summary = String(data?.summary || '').trim();
        if (!summary) {
            throw new Error('Could not fetch tutor summary right now.');
        }
        return summary;
    }

    function parseChoiceRevealConfig(rawContent = '') {
        const source = String(rawContent || '');
        const match = source.match(/\[button_reveal\]\s*([\s\S]*)$/i);
        if (!match) {
            return null;
        }

        const lines = match[1]
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .filter((line) => line !== '---');

        const buttons = lines
            .map((line) => {
                const separatorIdx = line.indexOf('|');
                if (separatorIdx <= 0) {
                    return null;
                }
                const label = line.slice(0, separatorIdx).trim();
                const text = line.slice(separatorIdx + 1).trim();
                if (!label || !text) {
                    return null;
                }
                return { label, text };
            })
            .filter(Boolean);

        if (buttons.length === 0) {
            return null;
        }

        const cleanedContent = source.replace(/\n?\[button_reveal\][\s\S]*$/i, '').trim();
        return { buttons, cleanedContent };
    }

    function renderChoiceRevealExercise(messageEl, section) {
        if (!messageEl || messageEl.querySelector('.teach-choice-reveal')) {
            return;
        }

        const contentEl = messageEl.querySelector('.message-content');
        if (!contentEl) {
            return;
        }

        const parsedConfig = parseChoiceRevealConfig(section?.content || '');
        if (!parsedConfig) {
            return;
        }

        const messageText = contentEl.querySelector('.message-text');
        if (messageText && typeof window.marked?.parse === 'function') {
            messageText.innerHTML = window.marked.parse(parsedConfig.cleanedContent || '');
        }

        const container = document.createElement('div');
        container.className = 'teach-choice-reveal';

        const buttonRow = document.createElement('div');
        buttonRow.className = 'teach-choice-reveal-buttons';

        const output = document.createElement('div');
        output.className = 'teach-choice-reveal-output';
        output.setAttribute('aria-live', 'polite');

        parsedConfig.buttons.forEach((item) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'teach-choice-reveal-button';
            button.textContent = item.label;

            button.addEventListener('click', () => {
                output.textContent = item.text;
                buttonRow.dataset.disabled = 'true';
                const rowButtons = buttonRow.querySelectorAll('button');
                rowButtons.forEach((rowButton) => {
                    rowButton.disabled = true;
                });
            });

            buttonRow.appendChild(button);
        });

        container.appendChild(buttonRow);
        container.appendChild(output);
        contentEl.appendChild(container);
    }

    const renderersByType = {
        match_words: renderMatchWordsExercise,
        sentence_builder: renderSentenceExercise,
        suspects_drag: renderSuspectsDragExercise,
        choice_reveal: renderChoiceRevealExercise,
        pick_explain: renderPickExplainExercise
    };

    const renderersById = {
        'week1-exercise-1-match-the-words': renderMatchWordsExercise,
        'week1-exercise-2-write-your-own-sentences': renderSentenceExercise,
        'week1-suspects-who-is-who': renderSuspectsDragExercise
    };

    function resolveInteractiveRenderer(section) {
        if (!section) {
            return null;
        }
        if (section.id && typeof renderersById[section.id] === 'function') {
            return renderersById[section.id];
        }
        const rendererType = String(section.renderer || '').trim();
        if (rendererType && typeof renderersByType[rendererType] === 'function') {
            return renderersByType[rendererType];
        }
        return null;
    }

    function decorateHeading(messageEl) {
        const headingEl = messageEl?.querySelector('.message-text strong');
        if (headingEl) {
            headingEl.classList.add('teach-section-heading');
        }
    }

    function alignStoryImageWithTextStart(messageEl) {
        if (!messageEl) {
            return;
        }

        const contentWrapper = messageEl.querySelector('.message-content-wrapper');
        const messageText = contentWrapper?.querySelector('.message-text');
        const storyImage = contentWrapper?.querySelector('.message-image');

        if (!messageText || !storyImage) {
            return;
        }

        const imageContainer = storyImage.parentElement;
        if (imageContainer && imageContainer !== messageText) {
            imageContainer.removeChild(storyImage);
            if (imageContainer.childElementCount === 0) {
                imageContainer.remove();
            }
        }

        storyImage.classList.add('teach-inline-story-image');
        messageText.prepend(storyImage);
    }

    const addSectionMessage = (chatArea, section, options = {}) => {
        if (typeof window.TeachSectionMessage?.addSectionMessage !== 'function') {
            return null;
        }
        return window.TeachSectionMessage.addSectionMessage(chatArea, section, {
            ...options,
            __deps: {
                addMessage,
                getSectionHeadingInfo,
                isBeforeReadingSection,
                alignStoryImageWithTextStart,
                resolveBeforeReadingImageSrc,
                openImageModal,
                parseAnswerKey,
                getAnswersForExercise,
                resolveInteractiveRenderer,
                renderFillInTheBlanksExercise,
                attachTaskControls
            }
        });
    };

    function addNotesMessage(chatArea, options = {}) {
        if (!chatArea) {
            return {};
        }
        const messageEl = addMessage(
            'system',
            'Reflection Notes',
            'Capture insights, predictions, or vocabulary you want to remember.'
        );

        if (!messageEl) {
            return {};
        }

        messageEl.classList.add('teach-notes-message');
        decorateHeading(messageEl);

        const content = messageEl.querySelector('.message-content');
        if (!content) {
            return {};
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'teach-notes-wrapper';

        const textarea = document.createElement('textarea');
        textarea.id = 'teachNotesTextarea';
        textarea.placeholder = 'Write your notes here…';
        textarea.value = options.notesValue ?? '';

        const status = document.createElement('div');
        status.id = 'teachNotesStatus';
        status.className = 'teach-notes-status';
        status.textContent = options.notesStatusText ?? 'Autosaved';

        wrapper.appendChild(textarea);
        wrapper.appendChild(status);
        content.appendChild(wrapper);

        return { messageEl, notesTextarea: textarea, notesStatusEl: status };
    }

    const renderWeekContent = (chatArea, week, options = {}) => {
        if (typeof window.TeachWeekContent?.renderWeekContent !== 'function') {
            return {};
        }
        return window.TeachWeekContent.renderWeekContent(chatArea, week, {
            ...options,
            __deps: {
                addMessage,
                isBeforeReadingSection,
                personalizeOnboardingQuestionnaireLink,
                decorateHeading,
                addSectionMessage,
                addNotesMessage,
                buildNextButtonLabel,
                resolveMessageElement,
                appendNextButton,
                requestTutorFinalSummary,
                stepProgressByWeek,
                TEACH_ONBOARDING_WELCOME_TEMPLATE
            }
        });
    };

    window.openImageModal = openImageModal;
    window.closeImageModal = closeImageModal;

    return {
        renderWeekSelector,
        renderWeekContent,
        setChatLoading,
        closeMenu,
        toggleMenu
    };
})();
