window.TeachSectionMessage = (() => {
    function addSectionMessage(chatArea, section, options = {}) {
        if (!chatArea || !section) {
            return;
        }

        const deps = options.__deps || {};
        const getSectionHeadingInfo = deps.getSectionHeadingInfo || (() => ({ heading: '', displayHeading: '', isStorySection: false }));
        const isBeforeReadingSection = deps.isBeforeReadingSection || (() => false);
        const addMessage = deps.addMessage || (() => null);
        const alignStoryImageWithTextStart = deps.alignStoryImageWithTextStart || (() => {});
        const resolveBeforeReadingImageSrc = deps.resolveBeforeReadingImageSrc || (() => []);
        const openImageModal = deps.openImageModal || (() => {});
        const parseAnswerKey = deps.parseAnswerKey || (() => ({}));
        const getAnswersForExercise = deps.getAnswersForExercise || (() => null);
        const resolveInteractiveRenderer = deps.resolveInteractiveRenderer || (() => null);
        const renderFillInTheBlanksExercise = deps.renderFillInTheBlanksExercise || (() => {});
        const attachTaskControls = deps.attachTaskControls || (() => {});

        const { heading, displayHeading, isStorySection } = getSectionHeadingInfo(section);
        const isBeforeReading = isBeforeReadingSection(section);
        const isStoryLike = isStorySection && !isBeforeReading;
        const isPortraitStory = isStoryLike && section.portrait === true;

        const sender =
            section.type === 'task'
                ? 'Weekly Mission'
                : isBeforeReading
                    ? 'Mentor'
                    : isStoryLike && displayHeading
                    ? displayHeading
                    : 'Mentor';
        const messageType = section.type === 'task' || isBeforeReading ? 'tutor-message' : 'bot';
        const parts = [];
        if (heading && (!isStoryLike || isBeforeReading)) {
            parts.push(`**${heading}**`);
        }
        if (section.content) {
            parts.push(section.content);
        }
        const messageEl = addMessage(
            messageType,
            sender || 'Mentor',
            parts.join('\n\n'),
            isBeforeReading ? null : section.image ?? null,
            null,
            isStoryLike,
            {
                sectionType: section.type,
                imageFirst: isPortraitStory
            }
        );

        if (messageEl) {
            messageEl.classList.add('teach-section-message', `teach-section-${section.type}`);
            messageEl.dataset.sectionId = section?.id || '';
            messageEl.dataset.sectionType = section?.type || '';
            messageEl.dataset.sectionCategory = section?.category || '';
            messageEl.dataset.renderer = section?.renderer || '';
            if (isPortraitStory) {
                messageEl.classList.add('teach-story-portrait');
                alignStoryImageWithTextStart(messageEl);
            }
            // Add data attribute to indicate if this is a reading section (for word highlighting)
            if (section.type === 'reading') {
                messageEl.dataset.sectionType = 'reading';
            }
            if (isBeforeReading) {
                const content = messageEl.querySelector('.message-content');
                if (content && !content.querySelector('.teach-before-reading-input')) {
                    const imageCandidates = resolveBeforeReadingImageSrc(section.image);
                    if (imageCandidates.length > 0) {
                        const image = document.createElement('img');
                        image.className = 'teach-before-reading-image';
                        image.alt = 'Before Reading word cloud';
                        image.loading = 'lazy';
                        image.style.cursor = 'zoom-in';
                        image.setAttribute('role', 'button');
                        image.setAttribute('tabindex', '0');
                        image.setAttribute('aria-label', 'Open word cloud in full screen');
                        let imageIndex = 0;
                        let currentImageSrc = '';

                        const setNextImage = () => {
                            if (imageIndex >= imageCandidates.length) {
                                image.remove();
                                return;
                            }
                            currentImageSrc = imageCandidates[imageIndex];
                            image.src = currentImageSrc;
                            imageIndex += 1;
                        };

                        image.addEventListener('click', () => {
                            openImageModal(currentImageSrc || image.src);
                        });
                        image.addEventListener('keydown', (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                openImageModal(currentImageSrc || image.src);
                            }
                        });
                        image.addEventListener('error', setNextImage);
                        setNextImage();
                        content.appendChild(image);
                    }

                    // Only add the default free-text textarea when there is no
                    // custom interactive renderer handling this section.
                    const hasCustomRenderer =
                        typeof resolveInteractiveRenderer(section) === 'function';

                    if (!hasCustomRenderer) {
                        const inputWrapper = document.createElement('div');
                        inputWrapper.className = 'teach-before-reading-input-wrapper';

                        const label = document.createElement('label');
                        label.className = 'teach-before-reading-input-label';
                        label.setAttribute('for', `teach-before-reading-${section.id}`);
                        label.textContent = 'Your prediction';

                        const textarea = document.createElement('textarea');
                        textarea.id = `teach-before-reading-${section.id}`;
                        textarea.className = 'teach-before-reading-input';
                        textarea.rows = 4;
                        textarea.placeholder = 'Write what you think this story will be about...';

                        inputWrapper.appendChild(label);
                        inputWrapper.appendChild(textarea);
                        content.appendChild(inputWrapper);
                    }
                }
            }

            // Get answerKey from week if provided
            const week = options.week;
            const answerKey = week ? parseAnswerKey(week) : {};
            const correctAnswers = getAnswersForExercise(answerKey, section);

            // Resolve renderer by id override first, then by type.
            const interactiveRenderer = resolveInteractiveRenderer(section);
            if (typeof interactiveRenderer === 'function') {
                interactiveRenderer(messageEl, section);
            } else {
                if (isBeforeReading) {
                    return messageEl;
                }
                // Auto-detect writing placeholders, fill-in-the-blanks exercises, or "Choose and Write" exercises
                const hasWritingPlaceholders =
                    /_{3,}|\[(?:small|medium|huge)_writing_space\]/i.test(section.content || '');
                const isChooseAndWrite = /choose and write/i.test(section.heading || '');
                if (hasWritingPlaceholders || isChooseAndWrite) {
                    renderFillInTheBlanksExercise(messageEl, section, correctAnswers);
                }
            }
        }

        if (section.type === 'task') {
            attachTaskControls(messageEl, section, options);
        }

        return messageEl;
    }

    return {
        addSectionMessage
    };
})();
