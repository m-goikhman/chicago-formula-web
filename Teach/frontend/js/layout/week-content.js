window.TeachWeekContent = (() => {
    function renderWeekContent(chatArea, week, options = {}) {
        const deps = options.__deps || {};
        const addMessage = deps.addMessage || (() => null);
        const isBeforeReadingSection = deps.isBeforeReadingSection || (() => false);
        const personalizeOnboardingQuestionnaireLink = deps.personalizeOnboardingQuestionnaireLink || ((text) => text);
        const decorateHeading = deps.decorateHeading || (() => {});
        const addSectionMessage = deps.addSectionMessage || (() => null);
        const addNotesMessage = deps.addNotesMessage || (() => ({}));
        const buildNextButtonLabel = deps.buildNextButtonLabel || (() => 'Continue');
        const resolveMessageElement = deps.resolveMessageElement || (() => null);
        const appendNextButton = deps.appendNextButton || (() => {});
        const requestTutorFinalSummary = deps.requestTutorFinalSummary || null;
        const requestTeachOutroQuestionnaire = deps.requestTeachOutroQuestionnaire || null;
        const buildLocalOutroQuestionnaireText = deps.buildLocalOutroQuestionnaireText || null;
        const getWeekExerciseSummary = deps.getWeekExerciseSummary || (() => null);
        const getWeekStepProgress = deps.getWeekStepProgress || (() => 1);
        const setWeekStepProgress = deps.setWeekStepProgress || (() => {});
        const TEACH_ONBOARDING_WELCOME_TEMPLATE = deps.TEACH_ONBOARDING_WELCOME_TEMPLATE;
        const TEACH_DEMO_ONBOARDING_INTRO = deps.TEACH_DEMO_ONBOARDING_INTRO;
        const TEACH_DEMO_SURVEY_FOLD_LABEL = deps.TEACH_DEMO_SURVEY_FOLD_LABEL;
        const renderMarkdownInto = deps.renderMarkdownInto || (() => {});
        const isDemoMode = options.isDemoMode === true;

        if (!chatArea) {
            return {};
        }

        chatArea.innerHTML = '';

        if (!week) {
            addMessage('system', 'Tutor', 'We could not find any episode materials yet.');
            return {};
        }

        const isFirstWeek = String(week.id || '').toLowerCase() === 'week1';
        const orderedSections = [...(week.sections ?? [])].sort((a, b) => a.order - b.order);
        const hasBeforeReadingSection = orderedSections.some((section) => isBeforeReadingSection(section));
        void hasBeforeReadingSection;
        if (isFirstWeek) {
            const suspectsExerciseId = 'week1-suspects-who-is-who';
            const suspectsIndex = orderedSections.findIndex((section) => section.id === suspectsExerciseId);
            const fionaIndex = orderedSections.findIndex((section) =>
                /three suspects/i.test(section.heading || '') &&
                /\*\*fiona\*\*/i.test(section.content || '')
            );

            if (
                suspectsIndex >= 0 &&
                fionaIndex >= 0 &&
                suspectsIndex > fionaIndex
            ) {
                const [suspectsSection] = orderedSections.splice(suspectsIndex, 1);
                orderedSections.splice(fionaIndex, 0, suspectsSection);
            }
        }
        const sequence = [];
        const participantCode = String(options.participantCode || '').trim();
        const onNotesReady = typeof options.onNotesReady === 'function' ? options.onNotesReady : null;
        let notesRefsResult = null;

        if (isFirstWeek && TEACH_ONBOARDING_WELCOME_TEMPLATE) {
            sequence.push({
                type: 'onboarding',
                factory: () => {
                    if (isDemoMode && TEACH_DEMO_ONBOARDING_INTRO) {
                        const onboardingMessage = addMessage('system', 'Tutor', TEACH_DEMO_ONBOARDING_INTRO);
                        if (!onboardingMessage) {
                            return null;
                        }
                        onboardingMessage.classList.add('tutor-message', 'teach-onboarding-message', 'teach-demo-onboarding');

                        const content = onboardingMessage.querySelector('.message-content');
                        const messageText = content?.querySelector('.message-text');
                        if (messageText) {
                            const studyBlock = personalizeOnboardingQuestionnaireLink(
                                TEACH_ONBOARDING_WELCOME_TEMPLATE,
                                participantCode
                            );
                            const details = document.createElement('details');
                            details.className = 'teach-demo-survey-fold';

                            const summary = document.createElement('summary');
                            summary.textContent = TEACH_DEMO_SURVEY_FOLD_LABEL || 'Study questionnaires (not required for demo)';
                            details.appendChild(summary);

                            const studyBody = document.createElement('div');
                            studyBody.className = 'teach-demo-survey-fold-body';
                            renderMarkdownInto(studyBody, studyBlock);
                            details.appendChild(studyBody);
                            messageText.appendChild(details);
                        }

                        return onboardingMessage;
                    }

                    const onboardingText = personalizeOnboardingQuestionnaireLink(
                        TEACH_ONBOARDING_WELCOME_TEMPLATE,
                        participantCode
                    );
                    const onboardingMessage = addMessage('system', 'Tutor', onboardingText);
                    if (onboardingMessage) {
                        onboardingMessage.classList.add('tutor-message', 'teach-onboarding-message');
                    }
                    return onboardingMessage;
                }
            });
        }

        orderedSections.forEach((section) => {
            sequence.push({
                type: 'section',
                section,
                factory: () =>
                    addSectionMessage(chatArea, section, {
                        week: week
                    })
            });
        });

        if (typeof requestTutorFinalSummary === 'function') {
            sequence.push({
                type: 'final_summary_cta',
                factory: () => {
                    const controlsMessage = addMessage(
                        'system',
                        'Tutor',
                        '',
                        null,
                        null,
                        false,
                        { messageClass: 'tutor-message' }
                    );
                    if (!controlsMessage) {
                        return null;
                    }

                    const content = controlsMessage.querySelector('.message-content');
                    if (!content) {
                        return controlsMessage;
                    }
                    let completionInfo = null;
                    const updateCompletionInfo = () => {
                        const summary = getWeekExerciseSummary(week.id);
                        if (!summary || !content) {
                            return;
                        }
                        if (!completionInfo || !content.contains(completionInfo)) {
                            const existing = content.querySelector('.teach-episode-completion-summary');
                            if (existing) {
                                completionInfo = existing;
                            } else {
                                completionInfo = document.createElement('div');
                                completionInfo.className = 'teach-episode-completion-summary';
                                content.appendChild(completionInfo);
                            }
                        }
                        completionInfo.textContent = (
                            `Completed exercises: ${summary.completed}/${summary.total} (${summary.percent}%). `
                            + `Required to unlock next episode: ${summary.requiredToUnlock}/${summary.total}. `
                            + (summary.isUnlocked ? 'Congratulations! You have completed the episode.' : 'Complete more exercises to finish the episode.')
                        );
                    };
                    const onProgressUpdated = (event) => {
                        const detailWeekId = String(event?.detail?.currentWeekId || '').trim();
                        if (!detailWeekId || detailWeekId === String(week.id)) {
                            updateCompletionInfo();
                        }
                    };
                    window.addEventListener('teach:progress-updated', onProgressUpdated);

                    const actions = document.createElement('div');
                    actions.className = 'teach-final-summary-actions';

                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'teach-final-summary-btn';
                    button.textContent = 'Get tutor final summary';

                    const status = document.createElement('div');
                    status.className = 'teach-final-summary-status';
                    status.hidden = true;

                    button.addEventListener('click', async () => {
                        if (button.disabled) {
                            return;
                        }
                        button.disabled = true;
                        status.hidden = false;
                        status.textContent = 'Generating summary...';

                        try {
                            const summary = await requestTutorFinalSummary();
                            addMessage('bot', 'AI Tutor', summary, null, null, false, { hideAvatar: true });
                            status.textContent = 'Summary added below.';
                        } catch (error) {
                            status.textContent = error?.message || 'Could not fetch tutor summary right now.';
                            button.disabled = false;
                            return;
                        }
                    });

                    actions.appendChild(button);
                    actions.appendChild(status);
                    content.appendChild(actions);
                    updateCompletionInfo();
                    return controlsMessage;
                }
            });

            sequence.push({
                type: 'final_outro',
                factory: () => {
                    const outroMessage = addMessage(
                        'system',
                        'Tutor',
                        'Loading end-of-episode message...',
                        '/images/Ep2-final_teach.png',
                        null,
                        false,
                        { messageClass: 'tutor-message', imageFirst: true }
                    );
                    if (!outroMessage) {
                        return null;
                    }

                    outroMessage.classList.add('teach-final-summary-cta');
                    const content = outroMessage.querySelector('.message-content');
                    if (!content) {
                        return outroMessage;
                    }

                    const messageText = content.querySelector('.message-text');
                    const outroOptions = {
                        participantCode: String(options.participantCode || '').trim(),
                        isDemoMode: options.isDemoMode === true,
                        firstLoginAtMs: Number(options.firstLoginAtMs) || Date.now()
                    };
                    const renderOutroText = (extraText = '') => {
                        if (!messageText || typeof renderMarkdownInto !== 'function') {
                            return;
                        }
                        renderMarkdownInto(messageText, extraText);
                    };
                    const fallbackOutroText = typeof buildLocalOutroQuestionnaireText === 'function'
                        ? buildLocalOutroQuestionnaireText(week.id, outroOptions)
                        : '';

                    renderOutroText(fallbackOutroText);

                    if (messageText && typeof requestTeachOutroQuestionnaire === 'function') {
                        requestTeachOutroQuestionnaire(week.id, outroOptions)
                            .then((outroText) => {
                                renderOutroText(outroText || fallbackOutroText);
                            })
                            .catch(() => {
                                renderOutroText(fallbackOutroText);
                            });
                    }

                    return outroMessage;
                }
            });
        }

        sequence.push({
            type: 'notes',
            factory: () => {
                const notesRefs = addNotesMessage(chatArea, {
                    notesValue: options.notesValue,
                    notesStatusText: options.notesStatusText
                });

                if (onNotesReady && notesRefs.notesTextarea) {
                    onNotesReady(notesRefs);
                } else if (onNotesReady) {
                    onNotesReady(notesRefs);
                }

                notesRefsResult = notesRefs;
                return notesRefs;
            }
        });

        sequence.forEach((step, index) => {
            const nextStep = sequence[index + 1];
            if (!nextStep) {
                return;
            }
            step.label = buildNextButtonLabel(step.type, {
                week,
                section: step.section,
                nextStep
            });
        });

        const renderedSteps = [];

        const renderStepAt = (index) => {
            const step = sequence[index];
            if (!step || typeof step.factory !== 'function') {
                return null;
            }
            const result = step.factory();
            const messageEl = resolveMessageElement(result);

            if (messageEl) {
                renderedSteps[index] = { step, messageEl };
            }

            if (step.type === 'notes' && notesRefsResult == null && result) {
                notesRefsResult = result;
            }

            return messageEl;
        };

        const totalSteps = sequence.length;
        const desiredProgress = Math.max(
            1,
            Math.min(getWeekStepProgress(week.id), totalSteps)
        );

        let actualRendered = 0;
        for (let i = 0; i < desiredProgress && i < totalSteps; i += 1) {
            const rendered = renderStepAt(i);
            if (!rendered) {
                break;
            }
            actualRendered = i + 1;
        }

        const unlockedSteps = Math.max(actualRendered, 1);
        setWeekStepProgress(week.id, unlockedSteps);

        const setupNextButton = (currentIndex) => {
            const current = renderedSteps[currentIndex];
            const nextIndex = currentIndex + 1;
            if (!current || nextIndex >= totalSteps) {
                return;
            }

            appendNextButton(
                current.messageEl,
                () => {
                    const newMessage = renderStepAt(nextIndex);
                    if (!newMessage) {
                        return;
                    }

                    const updatedProgress = Math.max(
                        getWeekStepProgress(week.id),
                        nextIndex + 1
                    );
                    setWeekStepProgress(week.id, updatedProgress);

                    chatArea.scrollTop = chatArea.scrollHeight;
                    setupNextButton(nextIndex);
                },
                current.step.label
            );
        };

        setupNextButton(unlockedSteps - 1);

        chatArea.scrollTop = chatArea.scrollHeight;
        return notesRefsResult ?? {};
    }

    return {
        renderWeekContent
    };
})();
