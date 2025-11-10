const TeachState = (() => {
    const STORAGE_KEY = window.TEACH_CONFIG.TEACH_PROGRESS_STORAGE_KEY;
    let weeks = [];
    let currentWeekId = null;
    let state = {
        tasks: {},
        notes: {},
        currentWeekId: null
    };

    function emitProgressEvent(detail = {}) {
        try {
            window.dispatchEvent(new CustomEvent('teach:progress-updated', { detail }));
        } catch (error) {
            console.warn('[TeachState] Failed to emit progress event:', error);
        }
    }

    function loadFromStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                return null;
            }
            const parsed = JSON.parse(raw);
            if (typeof parsed !== 'object' || parsed === null) {
                return null;
            }
            return parsed;
        } catch (error) {
            console.warn('[TeachState] Failed to read storage:', error);
            return null;
        }
    }

    function persist() {
        try {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({
                    tasks: state.tasks,
                    notes: state.notes,
                    currentWeekId
                })
            );
        } catch (error) {
            console.warn('[TeachState] Failed to persist progress:', error);
        }
        emitProgressEvent({
            currentWeekId,
            overall: getOverallProgress(),
            tasks: state.tasks,
            notes: state.notes
        });
    }

    function initialize(loadedWeeks) {
        weeks = loadedWeeks ?? [];
        const stored = loadFromStorage();
        state = {
            tasks: stored?.tasks ?? {},
            notes: stored?.notes ?? {}
        };
        currentWeekId = stored?.currentWeekId || weeks[0]?.id || null;

        // Ensure task maps exist
        weeks.forEach((week) => {
            if (!state.tasks[week.id]) {
                state.tasks[week.id] = {};
            }
            if (!state.notes[week.id]) {
                state.notes[week.id] = '';
            }
        });
        persist();
    }

    function getWeeks() {
        return weeks;
    }

    function getWeekById(weekId) {
        return weeks.find((week) => week.id === weekId);
    }

    function getCurrentWeekId() {
        return currentWeekId;
    }

    function setCurrentWeek(weekId) {
        if (weekId === currentWeekId) {
            return;
        }
        if (!getWeekById(weekId)) {
            console.warn(`[TeachState] Unknown week id: ${weekId}`);
            return;
        }
        currentWeekId = weekId;
        persist();
    }

    function getCurrentWeek() {
        return getWeekById(currentWeekId) ?? weeks[0] ?? null;
    }

    function toggleTaskCompletion(weekId, taskId, isCompleted) {
        if (!state.tasks[weekId]) {
            state.tasks[weekId] = {};
        }
        state.tasks[weekId][taskId] = Boolean(isCompleted);
        persist();
    }

    function isTaskCompleted(weekId, taskId) {
        return Boolean(state.tasks[weekId]?.[taskId]);
    }

    function setNotes(weekId, text) {
        state.notes[weekId] = text;
        persist();
    }

    function getNotes(weekId) {
        return state.notes[weekId] ?? '';
    }

    function getWeekProgress(weekId) {
        const week = getWeekById(weekId);
        if (!week) {
            return { completed: 0, total: 0 };
        }
        const total = week.tasks?.length ?? 0;
        const completed = week.tasks?.reduce((count, task) => {
            return count + (isTaskCompleted(weekId, task.id) ? 1 : 0);
        }, 0) ?? 0;
        return { completed, total };
    }

    function getOverallProgress() {
        const totals = weeks.reduce(
            (acc, week) => {
                const progress = getWeekProgress(week.id);
                return {
                    completed: acc.completed + progress.completed,
                    total: acc.total + progress.total
                };
            },
            { completed: 0, total: 0 }
        );
        return totals;
    }

    return {
        initialize,
        getWeeks,
        getCurrentWeekId,
        setCurrentWeek,
        getCurrentWeek,
        toggleTaskCompletion,
        isTaskCompleted,
        setNotes,
        getNotes,
        getWeekProgress,
        getOverallProgress
    };
})();

