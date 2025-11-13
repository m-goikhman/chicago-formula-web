const TeachUI = (() => {
    const shared = window.uiShared;
    if (!shared) {
        throw new Error('uiShared must be loaded before Teach UI');
    }

    const { addMessage } = shared;
    const stepProgressByWeek = new Map();

    /**
     * Парсит Answer Key из секции недели и возвращает объект с правильными ответами
     * @param {Object} week - объект недели с секциями
     * @returns {Object} объект с правильными ответами, ключ - название упражнения, значение - массив ответов
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

        // Парсим ответы в формате: **Exercise Name:** ответ1, ответ2, ответ3
        // Или: **Exercise Name:** 1. ответ1, 2. ответ2, 3. ответ3
        const exercisePattern = /\*\*([^*]+?):\*\*\s*([^\n]+)/g;
        let match;

        while ((match = exercisePattern.exec(content)) !== null) {
            const exerciseName = match[1].trim();
            const answersText = match[2].trim();

            // Нормализуем название упражнения для сопоставления
            const normalizedName = exerciseName.toLowerCase()
                .replace(/exercise\s*(\d+)/i, 'exercise $1')
                .replace(/grammar\s*exercise\s*(\d+)/i, 'grammar exercise $1')
                .trim();

            // Парсим ответы
            // Формат может быть: "1-d, 2-c, 3-a, 4-b" или "1. looked, 2. was trying, 3. were exchanging/received"
            const answers = [];
            
            // Если есть формат "1-ответ" или "1. ответ"
            const numberedPattern = /(\d+)[-.)]\s*([^,\n]+?)(?=\s*,\s*\d+[-.)]|$)/g;
            let answerMatch;
            while ((answerMatch = numberedPattern.exec(answersText)) !== null) {
                let answer = answerMatch[2].trim();
                // Убираем лишние пробелы и нормализуем
                // Сохраняем "/" в ответе, если он есть (для случаев типа "were exchanging/received")
                answers.push(answer);
            }

            // Если не нашли пронумерованные ответы, пробуем разбить по запятым
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
     * Находит правильные ответы для конкретного упражнения по его названию
     * @param {Object} answerKey - объект с правильными ответами из parseAnswerKey
     * @param {Object} section - секция упражнения
     * @returns {Array|null} массив правильных ответов или null, если не найдено
     */
    function getAnswersForExercise(answerKey, section) {
        if (!answerKey || !section) {
            return null;
        }

        const heading = section.heading || '';
        const content = section.content || '';
        
        // Нормализуем название упражнения для сопоставления
        const normalizedHeading = heading.toLowerCase()
            .replace(/grammar\s*focus[^:]*:\s*/i, '')
            .replace(/exercise\s*(\d+)/i, 'exercise $1')
            .replace(/grammar\s*exercise\s*(\d+)/i, 'grammar exercise $1')
            .trim();

        // Извлекаем номер упражнения, если есть
        const exerciseNumberMatch = normalizedHeading.match(/exercise\s*(\d+)/);
        const exerciseNumber = exerciseNumberMatch ? exerciseNumberMatch[1] : null;
        const isGrammarExercise = /grammar/i.test(normalizedHeading);

        // Пробуем найти точное совпадение
        for (const [key, answers] of Object.entries(answerKey)) {
            const normalizedKey = key.toLowerCase();
            
            // Если есть номер упражнения, проверяем его
            if (exerciseNumber) {
                const keyNumberMatch = normalizedKey.match(/exercise\s*(\d+)/);
                const keyNumber = keyNumberMatch ? keyNumberMatch[1] : null;
                
                if (keyNumber === exerciseNumber) {
                    // Проверяем, что это правильный тип упражнения (grammar или обычное)
                    const keyIsGrammar = /grammar/i.test(normalizedKey);
                    if (isGrammarExercise === keyIsGrammar) {
                        return answers;
                    }
                }
            }
            
            // Альтернативный способ: проверяем частичное совпадение
            if (normalizedHeading.includes(normalizedKey) || normalizedKey.includes(normalizedHeading)) {
                // Для "Grammar Exercise 2" ищем "grammar exercise 2"
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
        const content = typeof section?.content === 'string' ? section.content.trim() : '';
        const contentLength = content.length;
        
        // Exclude vocabulary sections from typewriter styling
        const normalizedHeading = heading.toLowerCase();
        const isVocabularySection = /vocabulary/i.test(normalizedHeading);
        
        // A section is a story/reading section if:
        // 1. It's marked as type 'reading', OR
        // 2. It has a heading and is a long text (>= 500 chars) - likely a reading text
        // BUT exclude vocabulary sections
        const isLongText = contentLength >= 500;
        const hasHeading = heading && heading.length > 0;
        
        const isStorySection =
            !isVocabularySection &&
            ((section?.type === 'reading' && hasHeading) ||
            (hasHeading && isLongText && section?.type !== 'task'));

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
        const { nextStep, week } = context;

        if (!nextStep) {
            return 'Continue';
        }

        if (nextStep.type === 'notes') {
            return "I'm ready to capture my notes";
        }

        const nextSection = nextStep.type === 'section' ? nextStep.section : null;

        const describeSection = (section) => {
            if (!section) {
                return { heading: '', info: { isStorySection: false } };
            }
            const info = getSectionHeadingInfo(section);
            const rawHeading = info.displayHeading || info.heading;
            const heading = truncateHeading(normaliseHeading(rawHeading));
            return { heading, info };
        };

        const { heading: nextHeading, info: nextInfo } = describeSection(nextSection);
        const nextType = nextSection?.type;

        const buildWithHeading = (prefix, fallback) => {
            if (nextHeading) {
                return `${prefix} "${nextHeading}"`;
            }
            return fallback;
        };

        if (stepType === 'summary') {
            if (nextSection) {
                if (nextInfo.isStorySection || nextType === 'reading') {
                    return buildWithHeading("Okay, let's start reading", "Okay, let's start reading");
                }
                if (nextType === 'task') {
                    return buildWithHeading("Okay, let's gear up for", "Okay, let's gear up for the mission");
                }
                if (nextType === 'vocabulary') {
                    return buildWithHeading("Okay, let's explore the new words in", "Okay, let's explore the new words");
                }
                if (nextType === 'reflection') {
                    return buildWithHeading("Okay, let's reflect on", "Okay, let's reflect");
                }
                if (/practice|exercise/i.test(nextType ?? '')) {
                    return buildWithHeading("Okay, let's practice with", "Okay, let's practice");
                }
                if (week?.title) {
                    return buildWithHeading("Okay, let's dive into", `Okay, let's dive into "${truncateHeading(normaliseHeading(week.title))}"`);
                }
            }
            return "Okay, let's get started";
        }

        if (stepType === 'section') {
            if (nextSection) {
                if (nextInfo.isStorySection || nextType === 'reading') {
                    return buildWithHeading("Let's keep reading", "Let's keep the story going");
                }
                if (nextType === 'task') {
                    return buildWithHeading("Ready for the mission", "I'm ready for the next mission");
                }
                if (nextType === 'vocabulary') {
                    return buildWithHeading("Let's review the vocabulary in", "Let's review the new vocabulary");
                }
                if (nextType === 'reflection') {
                    return buildWithHeading("Time to reflect on", "Time to reflect");
                }
                if (/practice|exercise/i.test(nextType ?? '')) {
                    return buildWithHeading("Let's try the exercise", "Let's try the next exercise");
                }
                return buildWithHeading("Show me what's next in", "Show me what's next");
            }
            return 'Keep going';
        }

        return 'Continue';
    }

    function ensureMenuInitialState(menuEl) {
        if (!menuEl || menuEl.dataset.initialized === 'true') {
            return;
        }
        if (window.innerWidth >= 1024) {
            menuEl.classList.add('active');
            const burger = document.getElementById('burgerButton');
            if (burger) {
                burger.classList.add('active');
            }
        }
        menuEl.dataset.initialized = 'true';
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

    function createMenuItem(week, isActive, onSelect) {
        const item = document.createElement('div');
        item.className = 'horizontal-menu-item';
        if (isActive) {
            item.classList.add('active');
        }

        item.innerHTML = `
            <div class="horizontal-menu-item-name">${week.title}</div>
            <div class="horizontal-menu-item-description">
                ${week.sections?.length ?? 0} sections · ${week.tasks?.length ?? 0} tasks
            </div>
        `;

        item.addEventListener('click', () => {
            onSelect?.(week.id);
            closeMenu();
        });

        return item;
    }

    function renderWeekMenu(menuEl, weeks, currentWeekId, callbacks = {}) {
        if (!menuEl) {
            return;
        }
        if (menuEl.dataset.userToggled !== 'true') {
            ensureMenuInitialState(menuEl);
        }
        menuEl.innerHTML = '';

        if (!weeks || weeks.length === 0) {
            const placeholder = document.createElement('div');
            placeholder.className = 'horizontal-menu-empty';
            placeholder.textContent = 'No weeks available yet.';
            menuEl.appendChild(placeholder);
            return;
        }

        weeks.forEach((week) => {
            const item = createMenuItem(week, week.id === currentWeekId, callbacks.onSelect);
            menuEl.appendChild(item);
        });
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

    function renderMatchWordsExercise(messageEl) {
        if (!messageEl || messageEl.querySelector('.teach-match-words')) {
            return;
        }

        const contentEl = messageEl.querySelector('.message-content');
        if (!contentEl) {
            return;
        }

        const messageText = contentEl.querySelector('.message-text');
        if (messageText) {
            messageText.innerHTML =
                '<p>Match each vocabulary word with its meaning, then check your answers.</p>';
        }

        const exerciseData = {
            words: [
                { word: 'eavesdrop', answer: 'd' },
                { word: 'deadline', answer: 'c' },
                { word: 'suspicious', answer: 'a' },
                { word: 'lurking', answer: 'b' }
            ],
            choices: [
                { letter: 'a', text: 'feeling something is wrong' },
                { letter: 'b', text: 'hiding and watching secretly' },
                { letter: 'c', text: 'the time by which you must finish' },
                { letter: 'd', text: "listening to others' private conversation" }
            ]
        };

        const lookupChoice = exerciseData.choices.reduce((acc, choice) => {
            acc[choice.letter] = choice;
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
                option.value = choice.letter;
                option.textContent = `${choice.letter.toUpperCase()}) ${choice.text}`;
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

        // Add Continue button to proceed to next exercise
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
                    feedback.textContent = `Correct: ${choice.letter.toUpperCase()}) ${choice.text}`;
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

    function renderSentenceExercise(messageEl) {
        if (!messageEl || messageEl.querySelector('.teach-sentence-exercise')) {
            return;
        }

        const contentEl = messageEl.querySelector('.message-content');
        if (!contentEl) {
            return;
        }

        const messageText = contentEl.querySelector('.message-text');
        if (messageText) {
            messageText.innerHTML =
                '<p>Write a complete sentence that naturally uses each highlighted vocabulary word. Press “Send” to check your sentence before moving on.</p>';
        }

        const prompts = [
            {
                word: 'suspicious',
                example: 'Fiona grew suspicious when she saw Alex leave with Pauline.'
            },
            {
                word: 'deadline',
                example: "Tim worried about the deadline Ronnie gave him for the money."
            },
            {
                word: 'lurking',
                example: 'Someone was lurking near the stairwell during the argument.'
            }
        ];

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

        // Add Continue button to proceed to next exercise
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
            choiceIndex = 0;
            allChoices.forEach((choiceSet) => {
                const options = choiceSet.options;
                choicesArray.push(options);
                
                // Use correct answer from Answer Key if available
                if (correctAnswersFromKey && Array.isArray(correctAnswersFromKey) && correctAnswersFromKey[answerKeyIndex]) {
                    let correctAnswer = correctAnswersFromKey[answerKeyIndex];
                    
                    // Handle cases where answer might be "were exchanging/received" (multiple answers for multiple choice sets)
                    // Check if this answer contains "/" and we have more choice sets ahead
                    if (correctAnswer.includes('/') && answerKeyIndex < correctAnswersFromKey.length - 1) {
                        // This might be a combined answer for multiple choice sets
                        // But we'll handle it per choice set - find the part that matches this set
                        const answerParts = correctAnswer.split('/').map(part => part.trim());
                        // Find the option that best matches any of the answer parts
                        const matchingOption = options.find(opt => 
                            answerParts.some(part => {
                                const optLower = opt.toLowerCase();
                                const partLower = part.toLowerCase();
                                return optLower === partLower || 
                                       optLower.includes(partLower) || 
                                       partLower.includes(optLower);
                            })
                        );
                        correctAnswers.push(matchingOption || options[0]);
                    } else if (correctAnswer.includes('/')) {
                        // Single answer with "/" but it's the last one - split and use first part
                        const answerParts = correctAnswer.split('/').map(part => part.trim());
                        const matchingOption = options.find(opt => 
                            answerParts.some(part => {
                                const optLower = opt.toLowerCase();
                                const partLower = part.toLowerCase();
                                return optLower === partLower || 
                                       optLower.includes(partLower) || 
                                       partLower.includes(optLower);
                            })
                        );
                        correctAnswers.push(matchingOption || options[0]);
                    } else {
                        // Single answer - find matching option (case-insensitive, partial match)
                        const matchingOption = options.find(opt => {
                            const optLower = opt.toLowerCase().trim();
                            const answerLower = correctAnswer.toLowerCase().trim();
                            return optLower === answerLower || 
                                   optLower.includes(answerLower) || 
                                   answerLower.includes(optLower);
                        });
                        correctAnswers.push(matchingOption || options[0]);
                    }
                    answerKeyIndex++;
                } else {
                    // Fallback to first option if no answer key provided
                    correctAnswers.push(options[0]);
                }
                choiceIndex++;
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

        // Add Continue button to proceed to next exercise
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

    const interactiveSectionRenderers = {
        'week1-exercise-1-match-the-words-written': renderMatchWordsExercise,
        'week1-exercise-2-write-your-own-sentences': renderSentenceExercise
    };

    function decorateHeading(messageEl) {
        const headingEl = messageEl?.querySelector('.message-text strong');
        if (headingEl) {
            headingEl.classList.add('teach-section-heading');
        }
    }

    function addSectionMessage(chatArea, section, options = {}) {
        if (!chatArea || !section) {
            return;
        }

        const { heading, displayHeading, isStorySection } = getSectionHeadingInfo(section);

        const sender =
            section.type === 'task'
                ? 'Weekly Mission'
                : isStorySection && displayHeading
                    ? displayHeading
                    : 'Mentor';
        const messageType = section.type === 'task' ? 'tutor-message' : 'bot';
        const parts = [];
        if (heading && !isStorySection) {
            parts.push(`**${heading}**`);
        }
        if (section.content) {
            parts.push(section.content);
        }
        const messageEl = addMessage(
            messageType,
            sender || 'Mentor',
            parts.join('\n\n'),
            null,
            null,
            isStorySection,
            { sectionType: section.type }
        );

        if (messageEl) {
            messageEl.classList.add('teach-section-message', `teach-section-${section.type}`);
            // Add data attribute to indicate if this is a reading section (for word highlighting)
            if (section.type === 'reading') {
                messageEl.dataset.sectionType = 'reading';
            }
            
            // Получаем answerKey из week, если он передан
            const week = options.week;
            const answerKey = week ? parseAnswerKey(week) : {};
            const correctAnswers = getAnswersForExercise(answerKey, section);
            
            // Check for specific interactive renderer first
            const specificRenderer = interactiveSectionRenderers[section.id];
            if (typeof specificRenderer === 'function') {
                specificRenderer(messageEl, section);
            } else {
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
        const summaryText =
            week.summary && !/new words/i.test(week.summary)
                ? week.summary
                : 'Review the story and missions below to get ready for your tutoring session.';
        const summaryParts = [
            `**${week.title}**`,
            summaryText,
            `_${weekProgress.completed}/${weekProgress.total} missions completed for this week._`
        ];
        const orderedSections = [...(week.sections ?? [])].sort((a, b) => a.order - b.order);
        const sequence = [];
        const onNotesReady = typeof options.onNotesReady === 'function' ? options.onNotesReady : null;
        let notesRefsResult = null;

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

    return {
        renderWeekMenu,
        renderWeekContent,
        setChatLoading,
        closeMenu,
        toggleMenu
    };
})();
