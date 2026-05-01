window.TeachPickExplain = (() => {

    const DEFAULT_PROMPT = 'Good thinking! Why do you think so? Which words gave you that idea?';

    function parsePickExplainConfig(rawContent) {
        const source = String(rawContent || '');
        const match = source.match(/\[pick_explain\]\s*([\s\S]*)$/i);
        if (!match) {
            return null;
        }

        const lines = match[1]
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .filter((line) => line !== '---');

        let prompt = DEFAULT_PROMPT;
        const options = [];

        lines.forEach((line) => {
            const promptMatch = line.match(/^prompt:\s*(.+)$/i);
            if (promptMatch) {
                prompt = promptMatch[1].trim();
                return;
            }

            const sep = line.indexOf('|');
            if (sep <= 0) {
                return;
            }
            const label = line.slice(0, sep).trim();
            const hint = line.slice(sep + 1).trim();
            if (label) {
                options.push({ label, hint });
            }
        });

        if (options.length === 0) {
            return null;
        }

        const cleanedContent = source.replace(/\n?\[pick_explain\][\s\S]*$/i, '').trim();
        return { prompt, options, cleanedContent };
    }

    function renderPickExplainExercise(messageEl, section) {
        if (!messageEl || messageEl.querySelector('.teach-pick-explain')) {
            return;
        }

        const contentEl = messageEl.querySelector('.message-content');
        if (!contentEl) {
            return;
        }

        const parsedConfig = parsePickExplainConfig(section && section.content || '');
        if (!parsedConfig) {
            return;
        }

        const messageText = contentEl.querySelector('.message-text');
        if (messageText) {
            if (typeof window.marked === 'object' && typeof window.marked.parse === 'function') {
                messageText.innerHTML = window.marked.parse(parsedConfig.cleanedContent || '');
            } else {
                messageText.textContent = parsedConfig.cleanedContent || '';
            }
        }

        const container = document.createElement('div');
        container.className = 'teach-pick-explain';

        const grid = document.createElement('div');
        grid.className = 'teach-pick-explain-grid';
        container.appendChild(grid);

        let whySection = null;

        parsedConfig.options.forEach((option) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'teach-pick-explain-card';
            card.setAttribute('aria-pressed', 'false');

            const labelEl = document.createElement('span');
            labelEl.className = 'teach-pick-explain-card-label';
            labelEl.textContent = option.label;
            card.appendChild(labelEl);

            if (option.hint) {
                const hintEl = document.createElement('span');
                hintEl.className = 'teach-pick-explain-card-hint';
                hintEl.textContent = option.hint;
                card.appendChild(hintEl);
            }

            card.addEventListener('click', () => {
                grid.querySelectorAll('.teach-pick-explain-card').forEach((c) => {
                    c.classList.remove('selected');
                    c.setAttribute('aria-pressed', 'false');
                });

                card.classList.add('selected');
                card.setAttribute('aria-pressed', 'true');

                if (!whySection) {
                    whySection = document.createElement('div');
                    whySection.className = 'teach-pick-explain-why';

                    const whyLabel = document.createElement('label');
                    whyLabel.className = 'teach-pick-explain-why-label';
                    const whyId = 'teach-pick-explain-why-' + (section && section.id || 'default');
                    whyLabel.setAttribute('for', whyId);
                    whyLabel.textContent = parsedConfig.prompt;

                    const whyTextarea = document.createElement('textarea');
                    whyTextarea.id = whyId;
                    whyTextarea.className = 'teach-pick-explain-why-textarea';
                    whyTextarea.rows = 3;
                    whyTextarea.placeholder = 'Write your answer here...';

                    whySection.appendChild(whyLabel);
                    whySection.appendChild(whyTextarea);
                    container.appendChild(whySection);

                    setTimeout(() => {
                        whyTextarea.focus();
                    }, 50);
                }
            });

            grid.appendChild(card);
        });

        contentEl.appendChild(container);
    }

    return {
        parsePickExplainConfig,
        renderPickExplainExercise
    };
})();
