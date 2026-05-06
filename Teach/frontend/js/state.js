const TeachState = (() => {
    const STORAGE_KEY = window.TEACH_CONFIG.TEACH_PROGRESS_STORAGE_KEY;
    const EPISODE_COMPLETION_THRESHOLD = Number(window.TEACH_CONFIG?.TEACH_EPISODE_COMPLETION_THRESHOLD || 0.75);
    const EXCLUDED_RENDERERS = new Set(window.TEACH_CONFIG?.TEACH_EXERCISE_PROGRESS_EXCLUDED_RENDERERS || []);
    let weeks = [];
    let currentWeekId = null;
    let state = {
        notes: {},
        exerciseStatusByWeek: {},
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
                    notes: state.notes,
                    exerciseStatusByWeek: state.exerciseStatusByWeek,
                    currentWeekId
                })
            );
        } catch (error) {
            console.warn('[TeachState] Failed to persist progress:', error);
        }
        emitProgressEvent({
            currentWeekId,
            overall: getOverallProgress(),
            notes: state.notes,
            exerciseStatusByWeek: state.exerciseStatusByWeek
        });
    }

    function initialize(loadedWeeks) {
        weeks = loadedWeeks ?? [];
        const stored = loadFromStorage();
        state = {
            notes: stored?.notes ?? {},
            exerciseStatusByWeek: stored?.exerciseStatusByWeek ?? {}
        };
        currentWeekId = stored?.currentWeekId || weeks[0]?.id || null;

        weeks.forEach((week) => {
            if (!state.notes[week.id]) {
                state.notes[week.id] = '';
            }
            if (!state.exerciseStatusByWeek[week.id] || typeof state.exerciseStatusByWeek[week.id] !== 'object') {
                state.exerciseStatusByWeek[week.id] = {};
            }
        });
        const availability = getWeekAvailability();
        const currentAvailability = availability.get(currentWeekId);
        if (!currentAvailability || currentAvailability.locked) {
            const firstUnlocked = weeks.find((week) => !availability.get(week.id)?.locked);
            currentWeekId = firstUnlocked?.id || weeks[0]?.id || null;
        }
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

    function setNotes(weekId, text) {
        state.notes[weekId] = text;
        persist();
    }

    function getNotes(weekId) {
        return state.notes[weekId] ?? '';
    }

    function isCountableExercise(section) {
        if (!section) {
            return false;
        }
        const isExercise = section.kind === 'exercise' || section.type === 'task';
        if (!isExercise) {
            return false;
        }
        const renderer = String(section.renderer || '').trim();
        if (renderer && EXCLUDED_RENDERERS.has(renderer)) {
            return false;
        }
        return true;
    }

    function getWeekExerciseSummary(weekId) {
        const week = getWeekById(weekId);
        if (!week) {
            return {
                completed: 0,
                total: 0,
                requiredToUnlock: 0,
                percent: 0,
                threshold: EPISODE_COMPLETION_THRESHOLD,
                isUnlocked: false
            };
        }

        const eligibleSections = (week.sections || []).filter(isCountableExercise);
        const statuses = state.exerciseStatusByWeek[weekId] || {};
        const completed = eligibleSections.reduce((acc, section) => {
            const sectionStatus = statuses[section.id];
            return acc + (sectionStatus?.status === 'passed' ? 1 : 0);
        }, 0);
        const total = eligibleSections.length;
        const requiredToUnlock = total > 0 ? Math.ceil(total * EPISODE_COMPLETION_THRESHOLD) : 0;
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        return {
            completed,
            total,
            requiredToUnlock,
            percent,
            threshold: EPISODE_COMPLETION_THRESHOLD,
            isUnlocked: total > 0 ? completed >= requiredToUnlock : true
        };
    }

    function setExerciseEvaluation(weekId, sectionId, evaluation = {}) {
        if (!weekId || !sectionId) {
            return;
        }
        if (!state.exerciseStatusByWeek[weekId] || typeof state.exerciseStatusByWeek[weekId] !== 'object') {
            state.exerciseStatusByWeek[weekId] = {};
        }
        const normalizedStatus = String(evaluation.status || '').trim().toLowerCase();
        const allowedStatuses = new Set(['pending', 'pending_short', 'failed', 'passed']);
        const status = allowedStatuses.has(normalizedStatus) ? normalizedStatus : 'pending';
        state.exerciseStatusByWeek[weekId][sectionId] = {
            status,
            passed: status === 'passed',
            source: String(evaluation.source || '').trim() || 'unknown',
            updatedAt: Date.now()
        };
        persist();
    }

    function getExerciseEvaluation(weekId, sectionId) {
        return state.exerciseStatusByWeek?.[weekId]?.[sectionId] || null;
    }

    function getWeekAvailability() {
        const availability = new Map();
        weeks.forEach((week, index) => {
            if (index === 0) {
                availability.set(week.id, {
                    locked: false,
                    status: 'available'
                });
                return;
            }
            const previousWeek = weeks[index - 1];
            const prevSummary = getWeekExerciseSummary(previousWeek.id);
            const locked = !prevSummary.isUnlocked;
            availability.set(week.id, {
                locked,
                status: locked ? 'locked' : 'available'
            });
        });
        return availability;
    }

    function getOverallProgress() {
        if (!weeks.length) {
            return { completed: 0, total: 0 };
        }
        let completed = 0;
        weeks.forEach((week, index) => {
            if (index === 0) {
                completed += 1;
                return;
            }
            if (getWeekExerciseSummary(weeks[index - 1].id).isUnlocked) {
                completed += 1;
            }
        });
        return { completed, total: weeks.length };
    }

    return {
        initialize,
        getWeeks,
        getCurrentWeekId,
        setCurrentWeek,
        getCurrentWeek,
        setNotes,
        getNotes,
        setExerciseEvaluation,
        getExerciseEvaluation,
        getWeekExerciseSummary,
        getWeekAvailability,
        getOverallProgress
    };
})();

