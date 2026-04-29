const TeachUI = (() => {
    const shared = window.uiShared;
    if (!shared) {
        throw new Error('uiShared must be loaded before Teach UI');
    }

    const { addMessage, buildImageUrl } = shared;
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

    /**
     * Parses Answer Key from week section and returns an object with correct answers
     * @param {Object} week - week object with sections
     * @returns {Object} object with correct answers, key - exercise name, value - array of answers
     */
    function parseAnswerKey(week) {
        if (!week || !week.sections) {
            return {};
        }

        const answerKeySection = week.sections.find(section => 
            /answer.?key/i.test(section.heading || '')
        );

        if (!answerKeySection || !answerKeySection.content) {
            return {};
        }

        const answerKey = {};
        const content = answerKeySection.content;

        // Parse answers in format: **Exercise Name:** answer1, answer2, answer3
        // Or: **Exercise Name:** 1. answer1, 2. answer2, 3. answer3
        const exercisePattern = /\*\*([^*]+?):\*\*\s*([^\n]+)/g;
        let match;

        while ((match = exercisePattern.exec(content)) !== null) {
            const exerciseName = match[1].trim();
            const answersText = match[2].trim();

            // Normalize exercise name for matching
            const normalizedName = exerciseName.toLowerCase()
                .replace(/exercise\s*(\d+)/i, 'exercise $1')
                .replace(/grammar\s*exercise\s*(\d+)/i, 'grammar exercise $1')
                .trim();

            // Parse answers
            // Format can be: "1-d, 2-c, 3-a, 4-b" or "1. looked, 2. was trying, 3. were exchanging/received"
            const answers = [];
            
            // If format is "1-answer" or "1. answer"
            const numberedPattern = /(\d+)[-.)]\s*([^,\n]+?)(?=\s*,\s*\d+[-.)]|$)/g;
            let answerMatch;
            while ((answerMatch = numberedPattern.exec(answersText)) !== null) {
                let answer = answerMatch[2].trim();
                // If answer contains "/", this may be multiple answers for one question
                // For example: "were exchanging/received" means two answers for two sets of options
                // But we'll save it as is and process it when matching with options
                answers.push(answer);
            }

            // If numbered answers not found, try splitting by commas
            if (answers.length === 0) {
                const parts = answersText.split(',').map(part => part.trim()).filter(Boolean);
                answers.push(...parts);
            }

            if (answers.length > 0) {
                answerKey[normalizedName] = answers;
            }
        }

        return answerKey;
    }

    /**
     * Finds correct answers for a specific exercise by its name
     * @param {Object} answerKey - object with correct answers from parseAnswerKey
     * @param {Object} section - exercise section
     * @returns {Array|null} array of correct answers or null if not found
     */
    function getAnswersForExercise(answerKey, section) {
        if (!answerKey || !section) {
            return null;
        }

        const heading = section.heading || '';
        const content = section.content || '';
        
        // Normalize exercise name for matching
        const normalizedHeading = heading.toLowerCase()
            .replace(/grammar\s*focus[^:]*:\s*/i, '')
            .replace(/exercise\s*(\d+)/i, 'exercise $1')
            .replace(/grammar\s*exercise\s*(\d+)/i, 'grammar exercise $1')
            .trim();

        // Extract exercise number if present
        const exerciseNumberMatch = normalizedHeading.match(/exercise\s*(\d+)/);
        const exerciseNumber = exerciseNumberMatch ? exerciseNumberMatch[1] : null;
        const isGrammarExercise = /grammar/i.test(normalizedHeading);

        // Try to find exact match
        for (const [key, answers] of Object.entries(answerKey)) {
            const normalizedKey = key.toLowerCase();
            
            // If exercise number exists, check it
            if (exerciseNumber) {
                const keyNumberMatch = normalizedKey.match(/exercise\s*(\d+)/);
                const keyNumber = keyNumberMatch ? keyNumberMatch[1] : null;
                
                if (keyNumber === exerciseNumber) {
                    // Check that this is the correct exercise type (grammar or regular)
                    const keyIsGrammar = /grammar/i.test(normalizedKey);
                    if (isGrammarExercise === keyIsGrammar) {
                        return answers;
                    }
                }
            }
            
            // Alternative method: check partial match
            if (normalizedHeading.includes(normalizedKey) || normalizedKey.includes(normalizedHeading)) {
                // For "Grammar Exercise 2" we look for "grammar exercise 2"
                if (normalizedHeading.includes('grammar exercise 2') && normalizedKey.includes('grammar exercise 2')) {
                    return answers;
                }
                if (normalizedHeading.includes('grammar exercise 1') && normalizedKey.includes('grammar exercise 1')) {
                    return answers;
                }
                if (normalizedHeading.includes('exercise 1') && normalizedKey.includes('exercise 1') && !normalizedHeading.includes('grammar')) {
                    return answers;
                }
                if (normalizedHeading.includes('exercise 3') && normalizedKey.includes('exercise 3')) {
                    return answers;
                }
            }
        }

        return null;
    }

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

    function resolveFullscreenImageUrl(imageUrl) {
        const raw = typeof imageUrl === 'string' ? imageUrl.trim() : '';
        if (!raw) {
            return imageUrl;
        }

        const replacementByFileName = {
            'clue3.png': 'clue3_bg.png',
            'nina.png': 'nina_bg.png'
        };
        const fileNameMatch = raw.match(/([^/?#]+)(\?[^#]*)?(#.*)?$/);
        const fileName = fileNameMatch ? fileNameMatch[1].toLowerCase() : '';
        const replacement = replacementByFileName[fileName];

        if (!replacement) {
            return imageUrl;
        }

        return raw.replace(/([^/?#]+)(\?[^#]*)?(#.*)?$/, `${replacement}$2$3`);
    }

    function openImageModal(imageUrl = null) {
        const overlay = document.getElementById('imageModalOverlay');
        const content = document.getElementById('imageModalContent');
        if (!overlay || !content) {
            return;
        }

        const fullscreenUrl = resolveFullscreenImageUrl(imageUrl);
        const resolvedUrl = typeof buildImageUrl === 'function' ? buildImageUrl(fullscreenUrl) : fullscreenUrl;
        if (!resolvedUrl) {
            return;
        }

        content.src = resolvedUrl;
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeImageModal() {
        const overlay = document.getElementById('imageModalOverlay');
        const content = document.getElementById('imageModalContent');
        if (!overlay) {
            return;
        }

        overlay.classList.remove('active');
        if (content) {
            content.src = '';
        }
        document.body.style.overflow = '';
    }

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

    function resolveBeforeReadingImageSrc(rawImagePath) {
        const path = typeof rawImagePath === 'string' ? rawImagePath.trim() : '';
        if (!path) {
            return [];
        }
        const normalizedPath = path.replace(/^\/+/, '');
        const fileName = normalizedPath.split('/').pop() || '';
        const staticTeachPath = /^(?:teach\/images\/|images\/)/i.test(normalizedPath)
            ? normalizedPath.replace(/^(?:teach\/images\/|images\/)/i, '')
            : fileName;

        const candidates = [
            staticTeachPath ? `images/${staticTeachPath}` : '',
            staticTeachPath ? `../images/${staticTeachPath}` : '',
            staticTeachPath ? `/images/${staticTeachPath}` : '',
            normalizedPath ? `/${normalizedPath}` : '',
            path,
            fileName ? buildImageUrl(fileName) : '',
            normalizedPath ? buildImageUrl(normalizedPath) : ''
        ];

        const unique = [];
        const seen = new Set();
        candidates
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .forEach((item) => {
                if (!seen.has(item)) {
                    seen.add(item);
                    unique.push(item);
                }
            });

        return unique;
    }

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

    function getWeekEpisodeMeta(week, index) {
        const fallbackNumber = index + 1;
        const title = String(week?.title || '').trim();
        const match = title.match(/^week\s*(\d+)\s*(?:[·:-]\s*)?(.*)$/i);
        const number = match ? Number(match[1]) : fallbackNumber;
        const name = match ? String(match[2] || '').trim() : title;
        return {
            number,
            title: name || title || `Week ${fallbackNumber}`
        };
    }

    function closeWeekSelectorDropdown() {
        const selector = document.getElementById('episodeSelector');
        const dropdown = document.getElementById('episodeDropdown');
        if (!selector || !dropdown) {
            return;
        }
        selector.classList.remove('dropdown-open');
        dropdown.style.display = 'none';
    }

    function renderWeekSelector(weeks, currentWeekId, callbacks = {}) {
        const selector = document.getElementById('episodeSelector');
        const display = document.getElementById('episodeDisplay');
        const dropdown = document.getElementById('episodeDropdown');
        if (!selector || !display || !dropdown) {
            return;
        }

        if (!weeks || weeks.length === 0) {
            selector.classList.remove('has-dropdown', 'dropdown-open');
            display.textContent = 'Episode';
            dropdown.style.display = 'none';
            dropdown.innerHTML = '';
            return;
        }

        const currentWeekIndex = Math.max(
            0,
            weeks.findIndex((week) => week.id === currentWeekId)
        );
        const currentWeek = weeks[currentWeekIndex] || weeks[0];
        const currentMeta = getWeekEpisodeMeta(currentWeek, currentWeekIndex);
        display.textContent = `Episode ${currentMeta.number}`;

        closeWeekSelectorDropdown();
        dropdown.innerHTML = '';

        weeks.forEach((week, index) => {
            const item = document.createElement('div');
            item.className = 'episode-dropdown-item';

            if (week.id === currentWeekId) {
                item.classList.add('current');
            }

            const meta = getWeekEpisodeMeta(week, index);
            const nameSpan = document.createElement('span');
            nameSpan.className = 'episode-name';
            nameSpan.textContent = `Episode ${meta.number}: ${meta.title}`;

            const statusSpan = document.createElement('span');
            statusSpan.className = 'episode-status';
            statusSpan.textContent = week.id === currentWeekId ? 'Current' : 'Available';

            item.appendChild(nameSpan);
            item.appendChild(statusSpan);

            item.addEventListener('click', () => {
                callbacks.onSelect?.(week.id);
                closeWeekSelectorDropdown();
            });

            dropdown.appendChild(item);
        });

        if (weeks.length <= 1) {
            selector.classList.remove('has-dropdown');
            display.style.cursor = 'default';
            return;
        }

        selector.classList.add('has-dropdown');
        display.style.cursor = 'pointer';
        display.onclick = (event) => {
            event.stopPropagation();
            const isOpen = selector.classList.toggle('dropdown-open');
            dropdown.style.display = isOpen ? 'block' : 'none';
        };

        if (document.body.dataset.teachSelectorOutsideHandlerBound !== 'true') {
            document.addEventListener('click', (event) => {
                if (!selector.contains(event.target)) {
                    closeWeekSelectorDropdown();
                }
            });
            document.body.dataset.teachSelectorOutsideHandlerBound = 'true';
        }
    }

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

    function parseMatchWordsConfig(rawContent = '') {
        const source = String(rawContent || '');
        const match = source.match(/\[match_words\]\s*([\s\S]*)$/i);
        if (!match) {
            return null;
        }

        const lines = match[1]
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .filter((line) => line !== '---');

        const entries = lines
            .map((line) => {
                const separatorIdx = line.indexOf('|');
                if (separatorIdx <= 0) {
                    return null;
                }
                const word = line.slice(0, separatorIdx).trim();
                const definition = line.slice(separatorIdx + 1).trim();
                if (!word || !definition) {
                    return null;
                }
                return { word, definition };
            })
            .filter(Boolean);

        if (entries.length === 0) {
            return null;
        }

        const words = [];
        const choices = [];
        entries.forEach((entry, index) => {
            const choiceId = String(index);
            words.push({ word: entry.word, answer: choiceId });
            choices.push({ id: choiceId, text: entry.definition });
        });

        if (words.length === 0 || choices.length === 0) {
            return null;
        }

        const cleanedContent = source.replace(/\n?\[match_words\][\s\S]*$/i, '').trim();
        return { words, choices, cleanedContent };
    }

    function renderMatchWordsExercise(messageEl, section) {
        if (!messageEl || messageEl.querySelector('.teach-match-words')) {
            return;
        }

        const contentEl = messageEl.querySelector('.message-content');
        if (!contentEl) {
            return;
        }

        const parsedConfig = parseMatchWordsConfig(section?.content || '');
        if (!parsedConfig) {
            return;
        }
        const exerciseData = parsedConfig;

        const messageText = contentEl.querySelector('.message-text');
        if (messageText) {
            const cleanedIntro =
                parsedConfig.cleanedContent || 'Match each vocabulary word with its meaning, then check your answers.';
            if (typeof window.marked?.parse === 'function') {
                messageText.innerHTML = window.marked.parse(cleanedIntro);
            } else {
                messageText.textContent = cleanedIntro;
            }
        }

        const lookupChoice = exerciseData.choices.reduce((acc, choice) => {
            acc[choice.id] = choice;
            return acc;
        }, {});

        const container = document.createElement('div');
        container.className = 'teach-match-words';

        const grid = document.createElement('div');
        grid.className = 'teach-match-words-grid';
        container.appendChild(grid);

        const wordsColumn = document.createElement('div');
        wordsColumn.className = 'teach-match-words-column';
        grid.appendChild(wordsColumn);

        const selectRefs = [];

        exerciseData.words.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = 'teach-match-words-item';

            const label = document.createElement('label');
            const selectId = `teach-match-${item.word}-${index}`;
            label.setAttribute('for', selectId);
            label.innerHTML = `<span class="teach-match-words-number">${index + 1}.</span> ${item.word}`;
            row.appendChild(label);

            const select = document.createElement('select');
            select.id = selectId;
            select.className = 'teach-match-words-select';
            select.dataset.correct = item.answer;

            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Choose the definition';
            placeholder.disabled = true;
            placeholder.selected = true;
            select.appendChild(placeholder);

            exerciseData.choices.forEach((choice) => {
                const option = document.createElement('option');
                option.value = choice.id;
                option.textContent = choice.text;
                select.appendChild(option);
            });

            row.appendChild(select);

            const feedback = document.createElement('div');
            feedback.className = 'teach-match-words-feedback';
            row.appendChild(feedback);

            wordsColumn.appendChild(row);
            selectRefs.push({ select, feedback, correct: item.answer });
        });

        const actions = document.createElement('div');
        actions.className = 'teach-match-words-actions';

        const checkButton = document.createElement('button');
        checkButton.type = 'button';
        checkButton.className = 'teach-match-words-button primary';
        checkButton.textContent = 'Check answers';
        actions.appendChild(checkButton);

        const resetButton = document.createElement('button');
        resetButton.type = 'button';
        resetButton.className = 'teach-match-words-button secondary';
        resetButton.textContent = 'Reset';
        actions.appendChild(resetButton);

        if (section?.type !== 'task') {
            const continueButton = document.createElement('button');
            continueButton.type = 'button';
            continueButton.className = 'teach-match-words-button continue';
            continueButton.textContent = 'Continue';
            continueButton.addEventListener('click', () => {
                // Try to find and click the next button if it exists
                const nextButton = messageEl.querySelector('.teach-next-button');
                if (nextButton && !nextButton.disabled) {
                    nextButton.click();
                } else {
                    // If no next button, try to trigger next step via custom event
                    const event = new CustomEvent('teach-continue-next', {
                        bubbles: true,
                        detail: { messageEl }
                    });
                    messageEl.dispatchEvent(event);
                }
            });
            actions.appendChild(continueButton);
        }

        container.appendChild(actions);

        const result = document.createElement('div');
        result.className = 'teach-match-words-result';
        container.appendChild(result);

        function clearState() {
            selectRefs.forEach(({ select, feedback }) => {
                select.value = '';
                select.classList.remove('correct', 'incorrect');
                feedback.textContent = '';
                feedback.classList.remove('correct', 'incorrect');
            });
            result.textContent = '';
            result.classList.remove('success', 'error', 'warning');
        }

        function validate() {
            let unanswered = false;
            let allCorrect = true;

            selectRefs.forEach(({ select, feedback, correct }) => {
                const value = select.value;
                select.classList.remove('correct', 'incorrect');
                feedback.classList.remove('correct', 'incorrect');

                if (!value) {
                    unanswered = true;
                    feedback.textContent = '';
                    return;
                }

                if (value === correct) {
                    select.classList.add('correct');
                    feedback.classList.add('correct');
                    feedback.textContent = 'Correct!';
                } else {
                    allCorrect = false;
                    select.classList.add('incorrect');
                    feedback.classList.add('incorrect');
                    const choice = lookupChoice[correct];
                    feedback.textContent = choice ? `Correct: ${choice.text}` : 'Incorrect.';
                }
            });

            if (unanswered) {
                result.textContent = 'Pick an answer for every word before checking.';
                result.classList.remove('success', 'error');
                result.classList.add('warning');
                return;
            }

            if (allCorrect) {
                result.textContent = 'Great job! All matches are correct.';
                result.classList.remove('warning', 'error');
                result.classList.add('success');
            } else {
                result.textContent = 'Review the highlighted corrections and try again.';
                result.classList.remove('success', 'warning');
                result.classList.add('error');
            }
        }

        checkButton.addEventListener('click', () => {
            result.classList.remove('success', 'error', 'warning');
            validate();
        });

        resetButton.addEventListener('click', () => {
            clearState();
        });

        contentEl.appendChild(container);
    }

    function parseSentenceBuilderConfig(rawContent = '') {
        const source = String(rawContent || '');
        const match = source.match(/\[sentence_builder\]\s*([\s\S]*)$/i);
        if (!match) {
            return null;
        }

        const lines = match[1]
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .filter((line) => line !== '---');

        const prompts = lines
            .map((line) => {
                const separatorIdx = line.indexOf('|');
                if (separatorIdx <= 0) {
                    return null;
                }
                const word = line.slice(0, separatorIdx).trim();
                const example = line.slice(separatorIdx + 1).trim();
                if (!word || !example) {
                    return null;
                }
                return { word, example };
            })
            .filter(Boolean);

        if (prompts.length === 0) {
            return null;
        }

        const cleanedContent = source.replace(/\n?\[sentence_builder\][\s\S]*$/i, '').trim();
        return { prompts, cleanedContent };
    }

    function renderSentenceExercise(messageEl, section) {
        if (!messageEl || messageEl.querySelector('.teach-sentence-exercise')) {
            return;
        }

        const contentEl = messageEl.querySelector('.message-content');
        if (!contentEl) {
            return;
        }

        const parsedConfig = parseSentenceBuilderConfig(section?.content || '');
        if (!parsedConfig) {
            return;
        }

        const messageText = contentEl.querySelector('.message-text');
        if (messageText) {
            const cleanedIntro =
                parsedConfig.cleanedContent ||
                'Write a complete sentence that naturally uses each highlighted vocabulary word. Press "Send" to check your sentence before moving on.';
            if (typeof window.marked?.parse === 'function') {
                messageText.innerHTML = window.marked.parse(cleanedIntro);
            } else {
                messageText.textContent = cleanedIntro;
            }
        }

        const prompts = parsedConfig.prompts;

        const container = document.createElement('div');
        container.className = 'teach-sentence-exercise';

        const status = document.createElement('div');
        status.className = 'teach-sentence-overall';

        let completedCount = 0;

        const updateStatus = () => {
            status.textContent = `${completedCount}/${prompts.length} sentences submitted`;
            status.classList.toggle('teach-sentence-overall-complete', completedCount === prompts.length);
        };

        prompts.forEach((prompt, index) => {
            const item = document.createElement('div');
            item.className = 'teach-sentence-item';

            const label = document.createElement('label');
            const inputId = `teach-sentence-${prompt.word}-${index}`;
            label.setAttribute('for', inputId);
            label.innerHTML = `<span class="teach-sentence-number">${index + 1}.</span> Use <strong>${prompt.word}</strong> in a sentence.`;
            item.appendChild(label);

            const textarea = document.createElement('textarea');
            textarea.id = inputId;
            textarea.className = 'teach-sentence-input';
            textarea.rows = 2;
            textarea.placeholder = `Write a sentence with “${prompt.word}”…`;
            item.appendChild(textarea);

            const actions = document.createElement('div');
            actions.className = 'teach-sentence-actions';

            const sendButton = document.createElement('button');
            sendButton.type = 'button';
            sendButton.className = 'teach-sentence-send';
            sendButton.textContent = 'Send';
            actions.appendChild(sendButton);

            item.appendChild(actions);

            const feedback = document.createElement('div');
            feedback.className = 'teach-sentence-feedback';
            item.appendChild(feedback);

            const example = document.createElement('div');
            example.className = 'teach-sentence-example';
            example.innerHTML = `<span>Example:</span> ${prompt.example}`;
            example.hidden = true;
            item.appendChild(example);

            const handleSuccess = () => {
                textarea.disabled = true;
                sendButton.disabled = true;
                feedback.textContent = 'Great sentence! You used the word correctly.';
                feedback.classList.remove('error');
                feedback.classList.add('success');
                example.hidden = false;
                completedCount += 1;
                updateStatus();
            };

            const handleError = (message) => {
                feedback.textContent = message;
                feedback.classList.remove('success');
                feedback.classList.add('error');
            };

            const containsWord = (value) => {

                const escapedWord = prompt.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const pattern = new RegExp(`\\b${escapedWord}(?=[a-zA-Z]|[.!?]|\\s|$)`, 'i');
                return pattern.test(value);
            };

            const validateSentence = () => {
                const value = textarea.value.trim();
                if (!value) {
                    handleError('Write your sentence before sending.');
                    return;
                }
                if (value.length < 10) {
                    handleError('Add more detail so your sentence feels complete.');
                    return;
                }
                if (!containsWord(value)) {
                    handleError(`Make sure you include the word “${prompt.word}” in your sentence.`);
                    return;
                }
                handleSuccess();
            };

            sendButton.addEventListener('click', validateSentence);
            textarea.addEventListener('keydown', (event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault();
                    if (!sendButton.disabled) {
                        validateSentence();
                    }
                }
            });

            container.appendChild(item);
        });

        updateStatus();
        container.appendChild(status);

        if (section?.type !== 'task') {
            const continueActions = document.createElement('div');
            continueActions.className = 'teach-sentence-actions';
            const continueButton = document.createElement('button');
            continueButton.type = 'button';
            continueButton.className = 'teach-sentence-send continue';
            continueButton.textContent = 'Continue';
            continueButton.addEventListener('click', () => {
                // Try to find and click the next button if it exists
                const nextButton = messageEl.querySelector('.teach-next-button');
                if (nextButton && !nextButton.disabled) {
                    nextButton.click();
                } else {
                    // If no next button, try to trigger next step via custom event
                    const event = new CustomEvent('teach-continue-next', {
                        bubbles: true,
                        detail: { messageEl }
                    });
                    messageEl.dispatchEvent(event);
                }
            });
            continueActions.appendChild(continueButton);
            container.appendChild(continueActions);
        }

        contentEl.appendChild(container);
    }

    function renderSuspectsDragExercise(messageEl, section) {
        if (!messageEl || messageEl.querySelector('.teach-suspects-exercise')) {
            return;
        }

        const contentEl = messageEl.querySelector('.message-content');
        if (!contentEl) {
            return;
        }

        const messageText = contentEl.querySelector('.message-text');
        if (messageText) {
            messageText.innerHTML =
                '<p>Drag each name card to the correct suspect in the image, then check your answers.</p>';
        }

        const boardImageUrl = 'images/suspects_names_to_add.png';
        const cardConfigs = [
            {
                id: 'tim',
                label: 'Tim',
                image: 'images/Tim_name.png'
            },
            {
                id: 'ronnie',
                label: 'Ronnie',
                image: 'images/Ronnie_name.png'
            }
        ];
        const zoneConfigs = [
            { id: 'ronnie', label: 'Ronnie slot', left: '48%', top: '42%' },
            { id: 'tim', label: 'Tim slot', left: '70%', top: '72%' }
        ];
        const correctPlacements = { tim: 'tim', ronnie: 'ronnie' };
        const placements = { tim: null, ronnie: null };
        let selectedCardId = null;

        const container = document.createElement('div');
        container.className = 'teach-suspects-exercise';

        const board = document.createElement('div');
        board.className = 'teach-suspects-board';

        const boardImage = document.createElement('img');
        boardImage.className = 'teach-suspects-board-image';
        boardImage.src = boardImageUrl;
        boardImage.alt = 'Suspects image with missing names';
        board.appendChild(boardImage);

        const zonesLayer = document.createElement('div');
        zonesLayer.className = 'teach-suspects-zones';
        board.appendChild(zonesLayer);

        const cards = document.createElement('div');
        cards.className = 'teach-suspects-cards';

        const actions = document.createElement('div');
        actions.className = 'teach-suspects-actions';

        const checkButton = document.createElement('button');
        checkButton.type = 'button';
        checkButton.className = 'teach-suspects-button primary';
        checkButton.textContent = 'Check answers';
        actions.appendChild(checkButton);

        const resetButton = document.createElement('button');
        resetButton.type = 'button';
        resetButton.className = 'teach-suspects-button secondary';
        resetButton.textContent = 'Reset';
        actions.appendChild(resetButton);

        if (section?.type !== 'task') {
            const continueButton = document.createElement('button');
            continueButton.type = 'button';
            continueButton.className = 'teach-suspects-button continue';
            continueButton.textContent = 'Continue';
            continueButton.addEventListener('click', () => {
                const nextButton = messageEl.querySelector('.teach-next-button');
                if (nextButton && !nextButton.disabled) {
                    nextButton.click();
                } else {
                    const event = new CustomEvent('teach-continue-next', {
                        bubbles: true,
                        detail: { messageEl }
                    });
                    messageEl.dispatchEvent(event);
                }
            });
            actions.appendChild(continueButton);
        }

        const result = document.createElement('div');
        result.className = 'teach-suspects-result';

        function getZoneByCard(cardId) {
            return Object.entries(placements).find(([, assignedCard]) => assignedCard === cardId)?.[0] ?? null;
        }

        function clearResult() {
            result.textContent = '';
            result.classList.remove('success', 'error', 'warning');
        }

        function placeCard(cardId, zoneId) {
            if (!cardId || !zoneId) {
                return;
            }

            const previousZone = getZoneByCard(cardId);
            if (previousZone) {
                placements[previousZone] = null;
            }

            const cardAlreadyInTarget = placements[zoneId];
            if (cardAlreadyInTarget && cardAlreadyInTarget !== cardId) {
                const occupiedZone = getZoneByCard(cardAlreadyInTarget);
                if (occupiedZone) {
                    placements[occupiedZone] = null;
                }
            }

            placements[zoneId] = cardId;
            selectedCardId = null;
            clearResult();
            render();
        }

        function createCardButton(card) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'teach-suspects-card';
            button.dataset.cardId = card.id;
            button.draggable = true;
            button.setAttribute('aria-label', `Card ${card.label}`);

            const image = document.createElement('img');
            image.src = card.image;
            image.alt = `${card.label} name card`;
            button.appendChild(image);

            if (selectedCardId === card.id) {
                button.classList.add('selected');
            }

            button.addEventListener('click', () => {
                selectedCardId = selectedCardId === card.id ? null : card.id;
                render();
            });

            button.addEventListener('dragstart', (event) => {
                event.dataTransfer?.setData('text/plain', card.id);
                event.dataTransfer.effectAllowed = 'move';
                selectedCardId = card.id;
                button.classList.add('dragging');
            });

            button.addEventListener('dragend', () => {
                button.classList.remove('dragging');
                selectedCardId = null;
                render();
            });

            return button;
        }

        function createDroppedCardElement(cardId) {
            const card = cardConfigs.find((item) => item.id === cardId);
            if (!card) {
                return null;
            }

            const dropped = document.createElement('div');
            dropped.className = 'teach-suspects-card dropped';

            const image = document.createElement('img');
            image.src = card.image;
            image.alt = `${card.label} name card`;
            dropped.appendChild(image);

            return dropped;
        }

        function createZone(zone) {
            const zoneEl = document.createElement('button');
            zoneEl.type = 'button';
            zoneEl.className = 'teach-suspects-zone';
            zoneEl.dataset.zoneId = zone.id;
            zoneEl.style.left = zone.left;
            zoneEl.style.top = zone.top;
            zoneEl.setAttribute('aria-label', `Drop zone for ${zone.label}`);

            const assignedCardId = placements[zone.id];
            if (assignedCardId) {
                zoneEl.classList.add('filled');
                const droppedCard = createDroppedCardElement(assignedCardId);
                if (droppedCard) {
                    zoneEl.appendChild(droppedCard);
                }
            } else {
                zoneEl.textContent = 'Drop card here';
            }

            zoneEl.addEventListener('click', () => {
                if (selectedCardId) {
                    placeCard(selectedCardId, zone.id);
                }
            });

            zoneEl.addEventListener('dragover', (event) => {
                event.preventDefault();
                zoneEl.classList.add('drag-over');
            });

            zoneEl.addEventListener('dragleave', () => {
                zoneEl.classList.remove('drag-over');
            });

            zoneEl.addEventListener('drop', (event) => {
                event.preventDefault();
                zoneEl.classList.remove('drag-over');
                const droppedCardId = event.dataTransfer?.getData('text/plain') || selectedCardId;
                placeCard(droppedCardId, zone.id);
            });

            return zoneEl;
        }

        function validate() {
            const allPlaced = Object.values(placements).every(Boolean);
            if (!allPlaced) {
                result.textContent = 'Place both cards before checking.';
                result.classList.remove('success', 'error');
                result.classList.add('warning');
                return;
            }

            const isCorrect = Object.entries(correctPlacements).every(
                ([zoneId, expectedCardId]) => placements[zoneId] === expectedCardId
            );

            if (isCorrect) {
                result.textContent = 'Excellent! You identified both suspects correctly.';
                result.classList.remove('warning', 'error');
                result.classList.add('success');
            } else {
                result.textContent = 'Not quite. Check who is standing and who is sitting, then try again.';
                result.classList.remove('warning', 'success');
                result.classList.add('error');
            }
        }

        function reset() {
            placements.tim = null;
            placements.ronnie = null;
            selectedCardId = null;
            clearResult();
            render();
        }

        function render() {
            cards.innerHTML = '';
            zonesLayer.innerHTML = '';

            const unplacedCards = cardConfigs.filter((card) => !getZoneByCard(card.id));
            unplacedCards.forEach((card) => {
                cards.appendChild(createCardButton(card));
            });

            zoneConfigs.forEach((zone) => {
                zonesLayer.appendChild(createZone(zone));
            });
        }

        checkButton.addEventListener('click', validate);
        resetButton.addEventListener('click', reset);

        render();
        container.appendChild(board);
        container.appendChild(cards);
        container.appendChild(actions);
        container.appendChild(result);
        contentEl.appendChild(container);
    }

    function renderFillInTheBlanksExercise(messageEl, section, correctAnswersFromKey = null) {
        if (!messageEl || messageEl.querySelector('.teach-fill-blanks')) {
            return;
        }

        const contentEl = messageEl.querySelector('.message-content');
        if (!contentEl) {
            return;
        }

        const messageText = contentEl.querySelector('.message-text');
        if (!messageText) {
            return;
        }

        // Determine if this is a "Choose and Write" exercise (needs clickable choices)
        const isChooseAndWrite = /choose and write/i.test(section.heading || '');

        // Find all blanks in the rendered HTML (pattern: 3+ underscores)
        // Need to search in text nodes to avoid matching underscores in HTML attributes
        const blankPattern = /_{3,}/g;
        const walker = document.createTreeWalker(
            messageText,
            NodeFilter.SHOW_TEXT,
            null
        );

        const textNodesWithBlanks = [];
        let node;
        while ((node = walker.nextNode())) {
            if (blankPattern.test(node.textContent)) {
                textNodesWithBlanks.push(node);
            }
        }

        // For "Choose and Write" exercises, we don't need blanks - we work with clickable choices
        // For other exercises, we need blanks to proceed
        if (!isChooseAndWrite && textNodesWithBlanks.length === 0) {
            return; // No blanks found, skip this renderer
        }
        
        // For "Choose and Write", check if there are any choices to make clickable
        if (isChooseAndWrite) {
            const hasChoices = /<strong>.*?\/.*?<\/strong>|<b>.*?\/.*?<\/b>/i.test(messageText.innerHTML);
            if (!hasChoices) {
                return; // No choices found, skip this renderer
            }
        }

        // Extract choices from HTML if this is a "Choose and Write" exercise
        // Look for <strong> or <b> tags containing "option1 / option2" pattern
        // Use correct answers from Answer Key if available, otherwise fall back to first option
        const choicesArray = [];
        const correctAnswers = [];
        if (isChooseAndWrite) {
            const choicePattern = /<strong>(.*?)<\/strong>|<b>(.*?)<\/b>/gi;
            const htmlContent = messageText.innerHTML;
            let match;
            let choiceIndex = 0;
            let answerKeyIndex = 0; // Index for answers from Answer Key
            
            // First, collect all choice sets to understand the structure
            const allChoices = [];
            while ((match = choicePattern.exec(htmlContent)) !== null) {
                const choiceText = (match[1] || match[2] || '').trim();
                if (choiceText.includes(' / ')) {
                    const options = choiceText.split(' / ').map(opt => opt.trim());
                    allChoices.push({ options, index: choiceIndex });
                    choiceIndex++;
                }
            }
            
            // Now process each choice set with correct answers
            // We need to handle cases where one answer in Answer Key (like "were exchanging/received")
            // corresponds to multiple choice sets in the same question
            let answerKeyIdx = 0;
            let partIndexInAnswer = 0; // Track which part of a "/" answer we're using
            let currentAnswerParts = null; // Store split parts of current answer
            
            allChoices.forEach((choiceSet, idx) => {
                const options = choiceSet.options;
                choicesArray.push(options);
                
                // Use correct answer from Answer Key if available
                if (correctAnswersFromKey && Array.isArray(correctAnswersFromKey) && answerKeyIdx < correctAnswersFromKey.length) {
                    let correctAnswer = correctAnswersFromKey[answerKeyIdx];
                    
                    // Handle cases where answer contains "/" (multiple answers for multiple choice sets in one question)
                    // For example: "were exchanging/received" means two answers for two choice sets
                    if (correctAnswer && correctAnswer.includes('/')) {
                        // Split the answer into parts if we haven't already
                        if (!currentAnswerParts) {
                            currentAnswerParts = correctAnswer.split('/').map(part => part.trim());
                            partIndexInAnswer = 0;
                        }
                        
                        // Use the current part of the split answer
                        if (partIndexInAnswer < currentAnswerParts.length) {
                            const answerPart = currentAnswerParts[partIndexInAnswer];
                            const matchingOption = options.find(opt => {
                                const optLower = opt.toLowerCase().trim();
                                const partLower = answerPart.toLowerCase().trim();
                                return optLower === partLower || 
                                       optLower.includes(partLower) || 
                                       partLower.includes(optLower);
                            });
                            correctAnswers.push(matchingOption || options[0]);
                            partIndexInAnswer++;
                            
                            // If we've used all parts, move to next answer in Answer Key
                            if (partIndexInAnswer >= currentAnswerParts.length) {
                                answerKeyIdx++;
                                currentAnswerParts = null;
                                partIndexInAnswer = 0;
                            }
                        } else {
                            // Fallback if something went wrong
                            correctAnswers.push(options[0]);
                        }
                    } else {
                        // Single answer - find matching option (case-insensitive, partial match)
                        const matchingOption = options.find(opt => {
                            const optLower = opt.toLowerCase().trim();
                            const answerLower = (correctAnswer || '').toLowerCase().trim();
                            return optLower === answerLower || 
                                   optLower.includes(answerLower) || 
                                   answerLower.includes(optLower);
                        });
                        correctAnswers.push(matchingOption || options[0]);
                        answerKeyIdx++;
                        currentAnswerParts = null;
                        partIndexInAnswer = 0;
                    }
                } else {
                    // Fallback to first option if no answer key provided
                    correctAnswers.push(options[0]);
                }
            });
        }

        // Determine if this is a grammar exercise (needs smaller inline inputs)
        const isGrammarExercise = /grammar/i.test(section.heading || '') || 
                                  /grammar/i.test(section.category || '') ||
                                  /fill in the gaps?|choose and write/i.test(section.heading || '');

        // Create container for interactive exercise
        const container = document.createElement('div');
        container.className = 'teach-fill-blanks';
        if (isGrammarExercise) {
            container.classList.add('teach-fill-blanks-grammar');
        }
        if (isChooseAndWrite) {
            container.classList.add('teach-fill-blanks-choose-write');
        }
        
        // For "Choose and Write" exercises, make choices clickable
        if (isChooseAndWrite) {
            const htmlContent = messageText.innerHTML;
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlContent;
            
            // Find all choice elements and make them clickable
            const choiceElements = tempDiv.querySelectorAll('strong, b');
            let choiceIndex = 0;
            choiceElements.forEach((el) => {
                const choiceText = el.textContent.trim();
                if (choiceText.includes(' / ')) {
                    const options = choiceText.split(' / ').map(opt => opt.trim());
                    // Use correct answer from the parsed correctAnswers array
                    const correctAnswer = correctAnswers[choiceIndex] || options[0];
                    
                    // Create container for clickable choices with feedback
                    const choicesWrapper = document.createElement('span');
                    choicesWrapper.className = 'teach-choices-wrapper';
                    
                    const choicesContainer = document.createElement('span');
                    choicesContainer.className = 'teach-choices-container';
                    choicesContainer.dataset.choiceIndex = choiceIndex;
                    choicesContainer.dataset.correctAnswer = correctAnswer;
                    
                    options.forEach((option, optIndex) => {
                        const choiceButton = document.createElement('button');
                        choiceButton.type = 'button';
                        choiceButton.className = 'teach-choice-button';
                        choiceButton.textContent = option;
                        choiceButton.dataset.option = option;
                        choiceButton.dataset.choiceIndex = choiceIndex;
                        // Compare with correct answer (case-insensitive for robustness)
                        const isCorrect = option.toLowerCase().trim() === correctAnswer.toLowerCase().trim();
                        choiceButton.dataset.isCorrect = isCorrect ? 'true' : 'false';
                        
                        if (optIndex > 0) {
                            const separator = document.createTextNode(' / ');
                            choicesContainer.appendChild(separator);
                        }
                        choicesContainer.appendChild(choiceButton);
                    });
                    
                    // Add feedback container right after choices
                    const feedback = document.createElement('span');
                    feedback.className = 'teach-choice-feedback';
                    feedback.dataset.feedbackIndex = choiceIndex;
                    
                    choicesWrapper.appendChild(choicesContainer);
                    choicesWrapper.appendChild(feedback);
                    
                    el.parentNode.replaceChild(choicesWrapper, el);
                    choiceIndex++;
                }
            });
            
            messageText.innerHTML = tempDiv.innerHTML;
        } else {
            // Replace blanks in text nodes with input fields for non-Choose-and-Write exercises
            let blankIndex = 0;
            textNodesWithBlanks.forEach((textNode) => {
                const parent = textNode.parentNode;
                const text = textNode.textContent;
                const parts = text.split(blankPattern);
                const matches = text.match(blankPattern) || [];

                if (matches.length === 0) {
                    return;
                }

                const fragment = document.createDocumentFragment();
                
                parts.forEach((part, index) => {
                    if (part) {
                        fragment.appendChild(document.createTextNode(part));
                    }
                    if (index < matches.length) {
                        const input = document.createElement('input');
                        input.type = 'text';
                        input.id = `teach-blank-${section.id}-${blankIndex}`;
                        input.className = 'teach-blank-input';
                        input.dataset.blankIndex = blankIndex;
                        input.placeholder = 'Fill in the blank';
                        blankIndex++;
                        fragment.appendChild(input);
                    }
                });

                parent.replaceChild(fragment, textNode);
            });
        }

        // Get inputs reference (will be empty for Choose-and-Write exercises)
        const inputs = messageText.querySelectorAll('.teach-blank-input');
        
        // Add feedback containers after each input (only for non-Choose-and-Write exercises)
        if (!isChooseAndWrite) {
            inputs.forEach((input, index) => {
                // Ensure blankIndex is set correctly
                if (!input.dataset.blankIndex) {
                    input.dataset.blankIndex = index;
                }
                const blankIndex = input.dataset.blankIndex;
                
                const feedback = document.createElement('span');
                feedback.className = 'teach-blank-feedback';
                feedback.dataset.feedbackIndex = blankIndex;
                // Insert feedback right after the input
                if (input.nextSibling) {
                    input.parentNode.insertBefore(feedback, input.nextSibling);
                } else {
                    input.parentNode.appendChild(feedback);
                }
            });
        }
        
        // Add action buttons
        const actions = document.createElement('div');
        actions.className = 'teach-fill-blanks-actions';

        const checkButton = document.createElement('button');
        checkButton.type = 'button';
        checkButton.className = 'teach-fill-blanks-button primary';
        checkButton.textContent = 'Check answers';
        actions.appendChild(checkButton);

        const resetButton = document.createElement('button');
        resetButton.type = 'button';
        resetButton.className = 'teach-fill-blanks-button secondary';
        resetButton.textContent = 'Reset';
        actions.appendChild(resetButton);

        if (section?.type !== 'task') {
            const continueButton = document.createElement('button');
            continueButton.type = 'button';
            continueButton.className = 'teach-fill-blanks-button continue';
            continueButton.textContent = 'Continue';
            continueButton.addEventListener('click', () => {
                // Try to find and click the next button if it exists
                const nextButton = messageEl.querySelector('.teach-next-button');
                if (nextButton && !nextButton.disabled) {
                    nextButton.click();
                } else {
                    // If no next button, try to trigger next step via custom event
                    const event = new CustomEvent('teach-continue-next', {
                        bubbles: true,
                        detail: { messageEl }
                    });
                    messageEl.dispatchEvent(event);
                }
            });
            actions.appendChild(continueButton);
        }

        container.appendChild(actions);

        const result = document.createElement('div');
        result.className = 'teach-fill-blanks-result';
        container.appendChild(result);

        contentEl.appendChild(container);

        // Add click handlers for choice buttons in "Choose and Write" exercises
        // This must be done AFTER messageText.innerHTML is updated and container is added to DOM
        if (isChooseAndWrite) {
            const choiceButtons = messageText.querySelectorAll('.teach-choice-button');
            
            if (choiceButtons.length === 0) {
                console.warn('No choice buttons found for Choose and Write exercise');
            } else {
                choiceButtons.forEach((button) => {
                    button.addEventListener('click', function() {
                        const choiceIndex = parseInt(this.dataset.choiceIndex);
                        const selectedOption = this.dataset.option;
                        const isCorrect = this.dataset.isCorrect === 'true';
                        
                        // Find the feedback element for this choice set
                        const feedback = messageText.querySelector(`.teach-choice-feedback[data-feedback-index="${choiceIndex}"]`);
                        const container = this.closest('.teach-choices-container');
                        const allButtons = container?.querySelectorAll('.teach-choice-button') || [];
                        
                        // Remove previous classes from all buttons in this set
                        allButtons.forEach(btn => {
                            btn.classList.remove('correct', 'incorrect');
                        });
                        
                        // Add appropriate class to the clicked button
                        if (isCorrect) {
                            this.classList.add('correct');
                            if (feedback) {
                                feedback.textContent = '✓ Correct!';
                                feedback.classList.remove('incorrect');
                                feedback.classList.add('correct');
                            }
                        } else {
                            this.classList.add('incorrect');
                            if (feedback) {
                                const correctAnswer = container?.dataset.correctAnswer;
                                feedback.textContent = `✗ Incorrect. Correct: ${correctAnswer}`;
                                feedback.classList.remove('correct');
                                feedback.classList.add('incorrect');
                            }
                        }
                        
                        // Disable all buttons for this choice set
                        allButtons.forEach(btn => {
                            btn.disabled = true;
                            btn.classList.add('disabled');
                        });
                    });
                });
            }
        }

        // Validation logic
        function getFeedbackForInput(input) {
            const blankIndex = input.dataset.blankIndex;
            return messageText.querySelector(`.teach-blank-feedback[data-feedback-index="${blankIndex}"]`);
        }

        function clearState() {
            if (isChooseAndWrite) {
                // Clear feedback and reset buttons for "Choose and Write" exercises
                const feedbacks = messageText.querySelectorAll('.teach-choice-feedback');
                feedbacks.forEach(fb => {
                    fb.textContent = '';
                    fb.classList.remove('correct', 'incorrect');
                });
                
                const choiceButtons = messageText.querySelectorAll('.teach-choice-button');
                choiceButtons.forEach(btn => {
                    btn.disabled = false;
                    btn.classList.remove('disabled', 'correct', 'incorrect');
                });
            } else {
                // Clear inputs for other exercises
                inputs.forEach((input) => {
                    input.value = '';
                    input.classList.remove('correct', 'incorrect');
                    const feedback = getFeedbackForInput(input);
                    if (feedback) {
                        feedback.textContent = '';
                        feedback.classList.remove('correct', 'incorrect');
                    }
                });
            }
            
            result.textContent = '';
            result.classList.remove('success', 'error', 'warning');
        }

        function validate() {
            if (isChooseAndWrite) {
                // For "Choose and Write", check if all choices have been made
                const choiceContainers = messageText.querySelectorAll('.teach-choices-container');
                let allFilled = true;
                let allCorrect = true;
                
                choiceContainers.forEach((container) => {
                    const buttons = container.querySelectorAll('.teach-choice-button');
                    const hasSelection = Array.from(buttons).some(btn => 
                        btn.classList.contains('correct') || btn.classList.contains('incorrect')
                    );
                    
                    if (!hasSelection) {
                        allFilled = false;
                    } else {
                        const hasCorrect = Array.from(buttons).some(btn => btn.classList.contains('correct'));
                        if (!hasCorrect) {
                            allCorrect = false;
                        }
                    }
                });
                
                if (!allFilled) {
                    result.textContent = 'Please select an answer for each question.';
                    result.classList.remove('success', 'error');
                    result.classList.add('warning');
                } else if (allCorrect) {
                    result.textContent = 'Excellent! All answers are correct.';
                    result.classList.remove('warning', 'error');
                    result.classList.add('success');
                } else {
                    result.textContent = 'Some answers are incorrect. Review the feedback above.';
                    result.classList.remove('success', 'warning');
                    result.classList.add('error');
                }
            } else {
                // Regular validation for other exercises
                let allFilled = true;
                let hasEmpty = false;

                inputs.forEach((input) => {
                    const value = input.value.trim();
                    input.classList.remove('correct', 'incorrect');
                    const feedback = getFeedbackForInput(input);
                    
                    if (feedback) {
                        feedback.textContent = '';
                        feedback.classList.remove('correct', 'incorrect');
                    }

                    if (!value) {
                        hasEmpty = true;
                        allFilled = false;
                        return;
                    }

                    // For now, just mark as filled (can be extended with actual answer checking)
                    input.classList.add('correct');
                    if (feedback) {
                        feedback.textContent = '✓';
                        feedback.classList.add('correct');
                    }
                });

                if (hasEmpty) {
                    result.textContent = 'Please fill in all blanks before checking.';
                    result.classList.remove('success', 'error');
                    result.classList.add('warning');
                    return;
                }

                if (allFilled) {
                    result.textContent = 'All blanks filled! Great work.';
                    result.classList.remove('warning', 'error');
                    result.classList.add('success');
                }
            }
        }

        checkButton.addEventListener('click', validate);
        resetButton.addEventListener('click', clearState);

        // Allow Enter key to move to next input or check (only for text inputs, not Choose-and-Write)
        if (!isChooseAndWrite && inputs.length > 0) {
            inputs.forEach((input, index) => {
                if (input.tagName === 'INPUT') {
                    input.addEventListener('keydown', (event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            const nextInput = inputs[index + 1];
                            if (nextInput) {
                                nextInput.focus();
                            } else {
                                validate();
                            }
                        }
                    });
                }
            });
        }
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
        choice_reveal: renderChoiceRevealExercise
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

    function addSectionMessage(chatArea, section, options = {}) {
        if (!chatArea || !section) {
            return;
        }

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
                // Auto-detect fill-in-the-blanks exercises or "Choose and Write" exercises
                const hasBlanks = /_{3,}/.test(section.content || '');
                const isChooseAndWrite = /choose and write/i.test(section.heading || '');
                if (hasBlanks || isChooseAndWrite) {
                    renderFillInTheBlanksExercise(messageEl, section, correctAnswers);
                }
            }
        }

        if (section.type === 'task') {
            attachTaskControls(messageEl, section, options);
        }

        return messageEl;
    }

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

    function renderWeekContent(chatArea, week, options = {}) {
        if (!chatArea) {
            return {};
        }

        chatArea.innerHTML = '';

        if (!week) {
            addMessage('system', 'Mentor', 'We could not find any weekly materials yet.');
            return {};
        }

        const weekProgress = options.weekProgress ?? { completed: 0, total: 0 };
        const isFirstWeek = String(week.id || '').toLowerCase() === 'week1';
        const orderedSections = [...(week.sections ?? [])].sort((a, b) => a.order - b.order);
        const hasBeforeReadingSection = orderedSections.some((section) => isBeforeReadingSection(section));
        const summaryText = 'Review the story and missions below to get ready for your tutoring session.';
        const summaryParts = [
            `**${week.title}**`,
            summaryText,
            `_${weekProgress.completed}/${weekProgress.total} missions completed for this week._`
        ];
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
                        isTaskCompleted: options.isTaskCompleted,
                        onTaskToggle: options.onTaskToggle,
                        week: week
                    })
            });
        });

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
