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
        const stepProgressByWeek = deps.stepProgressByWeek || new Map();
        const TEACH_ONBOARDING_WELCOME_TEMPLATE = deps.TEACH_ONBOARDING_WELCOME_TEMPLATE;

        if (!chatArea) {
            return {};
        }

        chatArea.innerHTML = '';

        if (!week) {
            addMessage('system', 'Mentor', 'We could not find any weekly materials yet.');
            return {};
        }

        const isFirstWeek = String(week.id || '').toLowerCase() === 'week1';
        const orderedSections = [...(week.sections ?? [])].sort((a, b) => a.order - b.order);
        const hasBeforeReadingSection = orderedSections.some((section) => isBeforeReadingSection(section));
        void hasBeforeReadingSection;
        const summaryText = 'Review the story and missions below to get ready for your tutoring session.';
        const missionCount = week.tasks?.length ?? 0;
        const missionLine =
            missionCount > 0
                ? `_${missionCount} mission${missionCount === 1 ? '' : 's'} in this episode._`
                : '';
        const summaryParts = [`**${week.title}**`, summaryText];
        if (missionLine) {
            summaryParts.push(missionLine);
        }
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
                    const onboardingText = personalizeOnboardingQuestionnaireLink(
                        TEACH_ONBOARDING_WELCOME_TEMPLATE,
                        participantCode
                    );
                    const onboardingMessage = addMessage('system', 'Mentor', onboardingText);
                    if (onboardingMessage) {
                        onboardingMessage.classList.add('tutor-message', 'teach-onboarding-message');
                    }
                    return onboardingMessage;
                }
            });
        }

        sequence.push({
            type: 'summary',
            factory: () => {
                const summaryMessage = addMessage('bot', 'Mentor', summaryParts.join('\n\n'));
                decorateHeading(summaryMessage);
                return summaryMessage;
            }
        });

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
                    const ctaMessage = addMessage(
                        'system',
                        'Mentor',
                        'You finished the missions. Want feedback from your AI language tutor?'
                    );
                    if (!ctaMessage) {
                        return null;
                    }

                    ctaMessage.classList.add('teach-final-summary-cta');
                    const content = ctaMessage.querySelector('.message-content');
                    if (!content) {
                        return ctaMessage;
                    }

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
                    return ctaMessage;
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
            Math.min(stepProgressByWeek.get(week.id) ?? 1, totalSteps)
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
        stepProgressByWeek.set(week.id, unlockedSteps);

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
                        stepProgressByWeek.get(week.id) ?? 1,
                        nextIndex + 1
                    );
                    stepProgressByWeek.set(week.id, updatedProgress);

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
