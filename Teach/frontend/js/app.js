(() => {
    const menuEl = document.getElementById('horizontalMenu');
    const chatArea = document.getElementById('chatArea');
    const overallChipEl = document.getElementById('overallProgressChip');
    const burgerButton = document.getElementById('burgerButton');

    let notesSaveTimer = null;
    let notesStatusEl = null;

    function updateNotesStatus(statusText = 'Autosaved') {
        if (notesStatusEl) {
            notesStatusEl.textContent = statusText;
        }
    }

    function attachNotesHandler(textarea, weekId) {
        if (!textarea) {
            return;
        }
        textarea.addEventListener('input', (event) => {
            TeachState.setNotes(weekId, event.target.value);
            updateNotesStatus('Saving…');
            if (notesSaveTimer) {
                clearTimeout(notesSaveTimer);
            }
            notesSaveTimer = setTimeout(() => {
                updateNotesStatus('Autosaved');
            }, 600);
        });
    }

    function handleWeekSelect(weekId) {
        TeachState.setCurrentWeek(weekId);
        render();
    }

    function handleTaskToggle(taskId, completed) {
        const currentWeek = TeachState.getCurrentWeek();
        if (!currentWeek) {
            return;
        }
        TeachState.toggleTaskCompletion(currentWeek.id, taskId, completed);
        render();
    }

    function updateOverallChip() {
        if (!overallChipEl) {
            return;
        }
        const overallProgress = TeachState.getOverallProgress();
        const ratio = overallProgress.total > 0 ? overallProgress.completed / overallProgress.total : 0;
        overallChipEl.textContent = `Overall completion · ${Math.round(ratio * 100)}%`;
    }

    function showErrorState(message) {
        TeachUI.setChatLoading(chatArea, message);
    }

    function render() {
        const weeks = TeachState.getWeeks();
        const currentWeek = TeachState.getCurrentWeek();

        TeachUI.renderWeekMenu(menuEl, weeks, TeachState.getCurrentWeekId(), {
            onSelect: handleWeekSelect
        });

        if (!currentWeek) {
            showErrorState('No weeks found. Add markdown content to the Teach folder to get started.');
            updateOverallChip();
            return;
        }

        const weekProgress = TeachState.getWeekProgress(currentWeek.id);
        const { notesTextarea, notesStatusEl: statusEl } = TeachUI.renderWeekContent(chatArea, currentWeek, {
            isTaskCompleted: (taskId) => TeachState.isTaskCompleted(currentWeek.id, taskId),
            onTaskToggle: handleTaskToggle,
            notesValue: TeachState.getNotes(currentWeek.id),
            weekProgress
        });

        notesStatusEl = statusEl || null;
        if (notesSaveTimer) {
            clearTimeout(notesSaveTimer);
            notesSaveTimer = null;
        }
        updateNotesStatus('Autosaved');
        attachNotesHandler(notesTextarea, currentWeek.id);
        updateOverallChip();
    }

    document.addEventListener('DOMContentLoaded', async () => {
        TeachUI.setChatLoading(chatArea);
        try {
            const weeks = await loadTeachContent();
            TeachState.initialize(weeks);
            render();
        } catch (error) {
            console.error('[TeachApp] Failed to initialise Teach mode:', error);
            showErrorState('We could not load the detective course content. Please try reloading the page.');
        }
    });

    if (burgerButton && TeachUI.toggleMenu) {
        burgerButton.addEventListener('click', () => {
            TeachUI.toggleMenu();
        });
    }
})();

