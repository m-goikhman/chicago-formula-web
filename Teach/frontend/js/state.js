const TeachState = (() => {
    const STORAGE_KEY = window.TEACH_CONFIG.TEACH_PROGRESS_STORAGE_KEY;
    const EPISODE_COMPLETION_THRESHOLD = Number(window.TEACH_CONFIG?.TEACH_EPISODE_COMPLETION_THRESHOLD || 0.75);
    const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;
    const EXCLUDED_RENDERERS = new Set(window.TEACH_CONFIG?.TEACH_EXERCISE_PROGRESS_EXCLUDED_RENDERERS || []);
    let weeks = [];
    let currentWeekId = null;
    /** @type {'local'|string} Suffix for progress key (participant code or "local" without auth). */
    let storageParticipantSuffix = 'local';
    let state = {
        notes: {},
        exerciseStatusByWeek: {},
        currentWeekId: null,
        firstLoginAt: null,
        stepProgressByWeek: {},
        exerciseDraftsByWeek: {},
        updatedAt: 0
    };

    function normalizeParticipantSuffix(code) {
        const normalized = String(code || '')
            .trim()
            .toUpperCase();
        return normalized || 'local';
    }

    function getStorageKey() {
        return `${STORAGE_KEY}:${storageParticipantSuffix}`;
    }

    function setStorageParticipantCode(participantCode) {
        storageParticipantSuffix = normalizeParticipantSuffix(participantCode);
    }

    function emitProgressEvent(detail = {}) {
        try {
            window.dispatchEvent(new CustomEvent('teach:progress-updated', { detail }));
        } catch (error) {
            console.warn('[TeachState] Failed to emit progress event:', error);
        }
    }

    function loadFromStorage() {
        try {
            let raw = localStorage.getItem(getStorageKey());
            if (!raw && storageParticipantSuffix === 'local') {
                raw = localStorage.getItem(STORAGE_KEY);
            }
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
            const payload = {
                notes: state.notes,
                exerciseStatusByWeek: state.exerciseStatusByWeek,
                currentWeekId,
                firstLoginAt: state.firstLoginAt,
                stepProgressByWeek: state.stepProgressByWeek,
                exerciseDraftsByWeek: state.exerciseDraftsByWeek,
                updatedAt: Number(state.updatedAt) || Date.now()
            };
            localStorage.setItem(getStorageKey(), JSON.stringify(payload));
            if (storageParticipantSuffix === 'local' && localStorage.getItem(STORAGE_KEY)) {
                try {
                    localStorage.removeItem(STORAGE_KEY);
                } catch (removeError) {
                    console.warn('[TeachState] Failed to remove legacy progress key:', removeError);
                }
            }
        } catch (error) {
            console.warn('[TeachState] Failed to persist progress:', error);
        }
        emitProgressEvent({
            currentWeekId,
            overall: getOverallProgress(),
            notes: state.notes,
            exerciseStatusByWeek: state.exerciseStatusByWeek,
            updatedAt: Number(state.updatedAt) || Date.now()
        });
    }

    function touchUpdatedAt() {
        state.updatedAt = Date.now();
    }

    function toSerializableSnapshot() {
        return {
            notes: state.notes,
            exerciseStatusByWeek: state.exerciseStatusByWeek,
            currentWeekId,
            firstLoginAt: state.firstLoginAt,
            stepProgressByWeek: state.stepProgressByWeek,
            exerciseDraftsByWeek: state.exerciseDraftsByWeek,
            updatedAt: Number(state.updatedAt) || Date.now()
        };
    }

    function initialize(loadedWeeks) {
        weeks = loadedWeeks ?? [];
        const stored = loadFromStorage();
        const storedSteps =
            stored?.stepProgressByWeek && typeof stored.stepProgressByWeek === 'object'
                ? stored.stepProgressByWeek
                : {};
        const storedDrafts =
            stored?.exerciseDraftsByWeek && typeof stored.exerciseDraftsByWeek === 'object'
                ? stored.exerciseDraftsByWeek
                : {};
        state = {
            notes: stored?.notes ?? {},
            exerciseStatusByWeek: stored?.exerciseStatusByWeek ?? {},
            firstLoginAt: Number(stored?.firstLoginAt) || Date.now(),
            stepProgressByWeek: { ...storedSteps },
            exerciseDraftsByWeek: { ...storedDrafts },
            updatedAt: Number(stored?.updatedAt) || Date.now()
        };
        currentWeekId = stored?.currentWeekId || weeks[0]?.id || null;

        weeks.forEach((week) => {
            if (!state.notes[week.id]) {
                state.notes[week.id] = '';
            }
            if (!state.exerciseStatusByWeek[week.id] || typeof state.exerciseStatusByWeek[week.id] !== 'object') {
                state.exerciseStatusByWeek[week.id] = {};
            }
            if (typeof state.stepProgressByWeek[week.id] !== 'number' || !Number.isFinite(state.stepProgressByWeek[week.id])) {
                state.stepProgressByWeek[week.id] = 1;
            }
            if (!state.exerciseDraftsByWeek[week.id] || typeof state.exerciseDraftsByWeek[week.id] !== 'object') {
                state.exerciseDraftsByWeek[week.id] = {};
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
        touchUpdatedAt();
        persist();
    }

    function getCurrentWeek() {
        return getWeekById(currentWeekId) ?? weeks[0] ?? null;
    }

    function setNotes(weekId, text) {
        state.notes[weekId] = text;
        touchUpdatedAt();
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
        touchUpdatedAt();
        persist();
    }

    function getExerciseEvaluation(weekId, sectionId) {
        return state.exerciseStatusByWeek?.[weekId]?.[sectionId] || null;
    }

    function getWeekStepProgress(weekId) {
        const n = Number(state.stepProgressByWeek?.[weekId]);
        return Number.isFinite(n) && n >= 1 ? n : 1;
    }

    function setWeekStepProgress(weekId, unlockedStepCount) {
        if (!weekId) {
            return;
        }
        const n = Math.max(1, Math.floor(Number(unlockedStepCount) || 1));
        if (!state.stepProgressByWeek || typeof state.stepProgressByWeek !== 'object') {
            state.stepProgressByWeek = {};
        }
        if (state.stepProgressByWeek[weekId] === n) {
            return;
        }
        state.stepProgressByWeek[weekId] = n;
        touchUpdatedAt();
        persist();
    }

    function getExerciseDraft(weekId, draftKey) {
        if (!weekId || !draftKey) {
            return '';
        }
        const bucket = state.exerciseDraftsByWeek?.[weekId];
        if (!bucket || typeof bucket !== 'object') {
            return '';
        }
        return String(bucket[draftKey] ?? '');
    }

    function setExerciseDraft(weekId, draftKey, text) {
        if (!weekId || !draftKey) {
            return;
        }
        if (!state.exerciseDraftsByWeek || typeof state.exerciseDraftsByWeek !== 'object') {
            state.exerciseDraftsByWeek = {};
        }
        if (!state.exerciseDraftsByWeek[weekId] || typeof state.exerciseDraftsByWeek[weekId] !== 'object') {
            state.exerciseDraftsByWeek[weekId] = {};
        }
        const trimmed = String(text ?? '');
        if (!trimmed) {
            if (!Object.prototype.hasOwnProperty.call(state.exerciseDraftsByWeek[weekId], draftKey)) {
                return;
            }
            delete state.exerciseDraftsByWeek[weekId][draftKey];
            touchUpdatedAt();
            persist();
            return;
        }
        if (state.exerciseDraftsByWeek[weekId][draftKey] === trimmed) {
            return;
        }
        state.exerciseDraftsByWeek[weekId][draftKey] = trimmed;
        touchUpdatedAt();
        persist();
    }

    function clearPersistedProgress() {
        try {
            localStorage.removeItem(getStorageKey());
            localStorage.removeItem(STORAGE_KEY);
        } catch (error) {
            console.warn('[TeachState] Failed to clear storage:', error);
        }
    }

    function mergeSnapshot(remoteSnapshot, options = {}) {
        if (!remoteSnapshot || typeof remoteSnapshot !== 'object') {
            return false;
        }
        const preferRemote = options.preferRemote !== false;
        const remoteUpdatedAt = Number(remoteSnapshot.updatedAt) || 0;
        const localUpdatedAt = Number(state.updatedAt) || 0;
        if (preferRemote && remoteUpdatedAt > 0 && localUpdatedAt > remoteUpdatedAt) {
            return false;
        }

        const nextNotes = (
            remoteSnapshot.notes && typeof remoteSnapshot.notes === 'object'
        ) ? remoteSnapshot.notes : {};
        const nextStatus = (
            remoteSnapshot.exerciseStatusByWeek && typeof remoteSnapshot.exerciseStatusByWeek === 'object'
        ) ? remoteSnapshot.exerciseStatusByWeek : {};
        const nextSteps = (
            remoteSnapshot.stepProgressByWeek && typeof remoteSnapshot.stepProgressByWeek === 'object'
        ) ? remoteSnapshot.stepProgressByWeek : {};
        const nextDrafts = (
            remoteSnapshot.exerciseDraftsByWeek && typeof remoteSnapshot.exerciseDraftsByWeek === 'object'
        ) ? remoteSnapshot.exerciseDraftsByWeek : {};

        state.notes = { ...nextNotes };
        state.exerciseStatusByWeek = { ...nextStatus };
        state.stepProgressByWeek = { ...nextSteps };
        state.exerciseDraftsByWeek = { ...nextDrafts };
        state.firstLoginAt = Number(remoteSnapshot.firstLoginAt) || state.firstLoginAt || Date.now();
        state.updatedAt = remoteUpdatedAt || Date.now();

        const candidateWeek = String(remoteSnapshot.currentWeekId || '').trim();
        if (candidateWeek && getWeekById(candidateWeek)) {
            currentWeekId = candidateWeek;
        }

        weeks.forEach((week) => {
            if (!state.notes[week.id]) {
                state.notes[week.id] = '';
            }
            if (!state.exerciseStatusByWeek[week.id] || typeof state.exerciseStatusByWeek[week.id] !== 'object') {
                state.exerciseStatusByWeek[week.id] = {};
            }
            if (typeof state.stepProgressByWeek[week.id] !== 'number' || !Number.isFinite(state.stepProgressByWeek[week.id])) {
                state.stepProgressByWeek[week.id] = 1;
            }
            if (!state.exerciseDraftsByWeek[week.id] || typeof state.exerciseDraftsByWeek[week.id] !== 'object') {
                state.exerciseDraftsByWeek[week.id] = {};
            }
        });

        persist();
        return true;
    }

    function hasUnrestrictedEpisodeAccess() {
        return window.TeachAuth?.hasUnrestrictedEpisodeAccess?.() === true;
    }

    function getWeekAvailability() {
        const availability = new Map();
        if (hasUnrestrictedEpisodeAccess()) {
            weeks.forEach((week) => {
                availability.set(week.id, {
                    locked: false,
                    status: 'available',
                    failedConditions: []
                });
            });
            return availability;
        }

        const nowMs = Date.now();
        const firstLoginAtMs = Number(state.firstLoginAt) || nowMs;
        weeks.forEach((week, index) => {
            if (index === 0) {
                availability.set(week.id, {
                    locked: false,
                    status: 'available',
                    failedConditions: []
                });
                return;
            }
            const previousWeek = weeks[index - 1];
            const prevSummary = getWeekExerciseSummary(previousWeek.id);
            const requiredUnlockAtMs = firstLoginAtMs + (index * WEEK_IN_MS);
            const timeUnlocked = nowMs >= requiredUnlockAtMs;
            const progressUnlocked = prevSummary.isUnlocked;
            const failedConditions = [];
            if (!progressUnlocked) {
                failedConditions.push('progress');
            }
            if (!timeUnlocked) {
                failedConditions.push('time');
            }
            const locked = failedConditions.length > 0;
            availability.set(week.id, {
                locked,
                status: locked ? 'locked' : 'available',
                failedConditions,
                unlockAt: new Date(requiredUnlockAtMs).toISOString()
            });
        });
        return availability;
    }

    function getOverallProgress() {
        if (!weeks.length) {
            return { completed: 0, total: 0 };
        }

        let completed = 0;
        let total = 0;

        weeks.forEach((week) => {
            const eligibleSections = (week.sections || []).filter(isCountableExercise);
            total += eligibleSections.length;

            const statuses = state.exerciseStatusByWeek[week.id] || {};
            completed += eligibleSections.reduce((acc, section) => {
                const sectionStatus = statuses[section.id];
                return acc + (sectionStatus?.status === 'passed' ? 1 : 0);
            }, 0);
        });

        return { completed, total };
    }

    return {
        initialize,
        setStorageParticipantCode,
        getWeeks,
        getCurrentWeekId,
        setCurrentWeek,
        getCurrentWeek,
        setNotes,
        getNotes,
        setExerciseEvaluation,
        getExerciseEvaluation,
        getWeekStepProgress,
        setWeekStepProgress,
        getExerciseDraft,
        setExerciseDraft,
        toSerializableSnapshot,
        mergeSnapshot,
        clearPersistedProgress,
        getWeekExerciseSummary,
        getWeekAvailability,
        getOverallProgress
    };
})();

