window.TeachSentenceBuilder = (() => {
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

    return {
        parseSentenceBuilderConfig,
        renderSentenceExercise
    };
})();
