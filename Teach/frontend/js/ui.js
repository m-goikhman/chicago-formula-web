const TeachUI = (() => {
    const shared = window.uiShared;
    if (!shared) {
        throw new Error('uiShared must be loaded before Teach UI');
    }

    const { addMessage } = shared;

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

        const sender =
            section.type === 'task'
                ? 'Weekly Mission'
                : section.type === 'reading'
                    ? 'Story'
                    : 'Mentor';
        const messageType = section.type === 'task' ? 'tutor-message' : 'bot';
        const parts = [];
        if (section.heading) {
            parts.push(`**${section.heading}**`);
        }
        if (section.content) {
            parts.push(section.content);
        }
        const messageEl = addMessage(messageType, sender, parts.join('\n\n'));

        if (messageEl) {
            messageEl.classList.add('teach-section-message', `teach-section-${section.type}`);
            decorateHeading(messageEl);
        }

        if (section.type === 'task') {
            attachTaskControls(messageEl, section, options);
        }
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

        return { notesTextarea: textarea, notesStatusEl: status };
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
        const summaryMessage = addMessage('bot', 'Mentor', summaryParts.join('\n\n'));
        decorateHeading(summaryMessage);

        const orderedSections = [...(week.sections ?? [])].sort((a, b) => a.order - b.order);
        orderedSections.forEach((section) => {
            addSectionMessage(chatArea, section, {
                isTaskCompleted: options.isTaskCompleted,
                onTaskToggle: options.onTaskToggle
            });
        });

        const notesRefs = addNotesMessage(chatArea, {
            notesValue: options.notesValue,
            notesStatusText: options.notesStatusText
        });

        chatArea.scrollTop = chatArea.scrollHeight;
        return notesRefs;
    }

    return {
        renderWeekMenu,
        renderWeekContent,
        setChatLoading,
        closeMenu,
        toggleMenu
    };
})();
