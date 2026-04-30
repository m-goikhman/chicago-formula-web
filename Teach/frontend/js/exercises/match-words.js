window.TeachMatchWords = (() => {
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

        // Keep the original id->definition mapping from markdown as the source of truth,
        // but randomize definition order shown in selects so answers are not position-based.
        for (let i = choices.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [choices[i], choices[j]] = [choices[j], choices[i]];
        }

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

    return {
        parseMatchWordsConfig,
        renderMatchWordsExercise
    };
})();
