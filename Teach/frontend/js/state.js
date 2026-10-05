const TeachState = (() => {
    const STORAGE_KEY = window.TEACH_CONFIG.TEACH_PROGRESS_STORAGE_KEY;
    const EPISODE_COMPLETION_THRESHOLD = Number(window.TEACH_CONFIG?.TEACH_EPISODE_COMPLETION_THRESHOLD || 0.75);
    const EPISODE_UNLOCK_AFTER_COMPLETION_MS = Number(
        window.TEACH_CONFIG?.EPISODE_UNLOCK_AFTER_COMPLETION_MS
    ) || (12 * 60 * 60 * 1000);
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
        weekCompletedAt: {},
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

    function persist(options = {}) {
        try {
            const payload = {
                notes: state.notes,
                exerciseStatusByWeek: state.exerciseStatusByWeek,
                currentWeekId,
                firstLoginAt: state.firstLoginAt,
                weekCompletedAt: state.weekCompletedAt,
                stepProgressByWeek: state.stepProgressByWeek,
                exerciseDraftsByWeek: state.exerciseDraftsByWeek,
                updatedAt: Number(state.updatedAt) || 0
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
        if (options.emit === false) {
            return;
        }
        emitProgressEvent({
            currentWeekId,
            overall: getOverallProgress(),
            notes: state.notes,
            exerciseStatusByWeek: state.exerciseStatusByWeek,
            updatedAt: Number(state.updatedAt) || 0
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
            weekCompletedAt: state.weekCompletedAt,
            stepProgressByWeek: state.stepProgressByWeek,
            exerciseDraftsByWeek: state.exerciseDraftsByWeek,
            updatedAt: Number(state.updatedAt) || 0
        };
    }

    function snapshotLooksEmpty(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') {
            return true;
        }
        const steps = snapshot.stepProgressByWeek;
        const statuses = snapshot.exerciseStatusByWeek;
        const notes = snapshot.notes;
        const drafts = snapshot.exerciseDraftsByWeek;
        const hasAdvancedStep = Boolean(
            steps &&
            typeof steps === 'object' &&
            Object.values(steps).some((value) => Number(value) > 1)
        );
        const hasStatus = Boolean(
            statuses &&
            typeof statuses === 'object' &&
            Object.values(statuses).some((bucket) => bucket && typeof bucket === 'object' && Object.keys(bucket).length > 0)
        );
        const hasNotes = Boolean(
            notes &&
            typeof notes === 'object' &&
            Object.values(notes).some((text) => String(text || '').trim())
        );
        const hasDrafts = Boolean(
            drafts &&
            typeof drafts === 'object' &&
            Object.values(drafts).some((bucket) =>
                bucket &&
                typeof bucket === 'object' &&
                Object.values(bucket).some((text) => String(text || '').trim())
            )
        );
        return !hasAdvancedStep && !hasStatus && !hasNotes && !hasDrafts;
    }

    function orderedSectionsForWeek(week) {
        const orderedSections = [...(week?.sections ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        if (String(week?.id || '').toLowerCase() !== 'week1') {
            return orderedSections;
        }
        const suspectsExerciseId = 'week1-suspects-who-is-who';
        const suspectsIndex = orderedSections.findIndex((section) => section.id === suspectsExerciseId);
        const fionaIndex = orderedSections.findIndex((section) =>
            /three suspects/i.test(section.heading || '') &&
            /\*\*fiona\*\*/i.test(section.content || '')
        );
        if (suspectsIndex >= 0 && fionaIndex >= 0 && suspectsIndex > fionaIndex) {
            const [suspectsSection] = orderedSections.splice(suspectsIndex, 1);
            orderedSections.splice(fionaIndex, 0, suspectsSection);
        }
        return orderedSections;
    }

    function initialize(loadedWeeks, options = {}) {
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
        const storedCompletedAt =
            stored?.weekCompletedAt && typeof stored.weekCompletedAt === 'object'
                ? stored.weekCompletedAt
                : {};
        state = {
            notes: stored?.notes ?? {},
            exerciseStatusByWeek: stored?.exerciseStatusByWeek ?? {},
            firstLoginAt: Number(stored?.firstLoginAt) || Date.now(),
            weekCompletedAt: { ...storedCompletedAt },
            stepProgressByWeek: { ...storedSteps },
            exerciseDraftsByWeek: { ...storedDrafts },
            updatedAt: Number(stored?.updatedAt) || 0
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
            const summary = getWeekExerciseSummary(week.id);
            if (summary.isUnlocked && !state.weekCompletedAt[week.id]) {
                state.weekCompletedAt[week.id] = Date.now() - EPISODE_UNLOCK_AFTER_COMPLETION_MS - 1000;
            }
        });
        const availability = getWeekAvailability();
        const currentAvailability = availability.get(currentWeekId);
        if (!currentAvailability || currentAvailability.locked) {
            const firstUnlocked = weeks.find((week) => !availability.get(week.id)?.locked);
            currentWeekId = firstUnlocked?.id || weeks[0]?.id || null;
        }
        if (options.persist !== false) {
            persist({ emit: options.emit !== false });
        }
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

    function recordWeekCompletionIfNeeded(weekId) {
        const summary = getWeekExerciseSummary(weekId);
        if (!summary.isUnlocked) {
            return;
        }
        if (!state.weekCompletedAt || typeof state.weekCompletedAt !== 'object') {
            state.weekCompletedAt = {};
        }
        if (state.weekCompletedAt[weekId]) {
            return;
        }
        state.weekCompletedAt[weekId] = Date.now();
        touchUpdatedAt();
        persist();
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
        recordWeekCompletionIfNeeded(weekId);
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
        const current = getWeekStepProgress(weekId);
        if (n <= current) {
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

    function positiveInt(value) {
        const number = Number(value);
        if (!Number.isFinite(number) || number <= 0) {
            return 0;
        }
        return Math.floor(number);
    }

    function statusIsPassed(entry) {
        if (!entry || typeof entry !== 'object') {
            return false;
        }
        if (entry.passed === true) {
            return true;
        }
        return String(entry.status || '').trim().toLowerCase() === 'passed';
    }

    function mergeStatusEntry(existing, incoming) {
        if (!incoming || typeof incoming !== 'object') {
            return existing;
        }
        if (!existing || typeof existing !== 'object') {
            return { ...incoming };
        }
        if (statusIsPassed(existing) && !statusIsPassed(incoming)) {
            return existing;
        }
        return { ...existing, ...incoming };
    }

    function mergeDictOfDicts(base, incoming, valueMerge) {
        const merged = {};
        if (base && typeof base === 'object') {
            Object.entries(base).forEach(([weekId, bucket]) => {
                merged[weekId] = bucket && typeof bucket === 'object' ? { ...bucket } : bucket;
            });
        }
        if (!incoming || typeof incoming !== 'object') {
            return merged;
        }
        Object.entries(incoming).forEach(([weekId, bucket]) => {
            if (!bucket || typeof bucket !== 'object') {
                if (bucket !== undefined && bucket !== null && bucket !== '') {
                    merged[weekId] = bucket;
                }
                return;
            }
            if (!merged[weekId] || typeof merged[weekId] !== 'object') {
                merged[weekId] = {};
            }
            Object.entries(bucket).forEach(([key, value]) => {
                if (typeof valueMerge === 'function') {
                    merged[weekId][key] = valueMerge(merged[weekId][key], value);
                    return;
                }
                if (String(value || '').trim()) {
                    merged[weekId][key] = value;
                } else if (!Object.prototype.hasOwnProperty.call(merged[weekId], key)) {
                    merged[weekId][key] = value;
                }
            });
        });
        return merged;
    }

    function mergeNotes(existing, incoming) {
        const notes = existing && typeof existing === 'object' ? { ...existing } : {};
        if (!incoming || typeof incoming !== 'object') {
            return notes;
        }
        Object.entries(incoming).forEach(([weekId, text]) => {
            if (String(text || '').trim() && !String(notes[weekId] || '').trim()) {
                notes[weekId] = text;
            } else if (!Object.prototype.hasOwnProperty.call(notes, weekId)) {
                notes[weekId] = text;
            }
        });
        return notes;
    }

    function weekRank(weekId) {
        const match = String(weekId || '').match(/(\d+)/);
        return match ? Number(match[1]) : 0;
    }

    function pickCurrentWeekId(existingId, incomingId) {
        const candidates = [existingId, incomingId]
            .map((value) => String(value || '').trim())
            .filter(Boolean);
        if (!candidates.length) {
            return '';
        }
        return candidates.sort((a, b) => weekRank(a) - weekRank(b))[candidates.length - 1];
    }

    function mergeWeekCompletedAt(existing, incoming) {
        const merged = {};
        [existing, incoming].forEach((source) => {
            if (!source || typeof source !== 'object') {
                return;
            }
            Object.entries(source).forEach(([weekId, value]) => {
                const stamp = positiveInt(value);
                if (stamp <= 0) {
                    return;
                }
                const current = positiveInt(merged[weekId]);
                if (current <= 0 || stamp < current) {
                    merged[weekId] = stamp;
                }
            });
        });
        return merged;
    }

    function mergeClientState(existing, incoming) {
        const left = existing && typeof existing === 'object' ? existing : {};
        const right = incoming && typeof incoming === 'object' ? incoming : {};
        const merged = { ...left };
        Object.entries(right).forEach(([key, value]) => {
            if (!Object.prototype.hasOwnProperty.call(merged, key)) {
                merged[key] = value;
            }
        });
        merged.exerciseStatusByWeek = mergeDictOfDicts(
            left.exerciseStatusByWeek,
            right.exerciseStatusByWeek,
            mergeStatusEntry
        );
        merged.exerciseDraftsByWeek = mergeDictOfDicts(
            left.exerciseDraftsByWeek,
            right.exerciseDraftsByWeek
        );
        const mergedSteps = {};
        [left, right].forEach((source) => {
            const steps = source.stepProgressByWeek;
            if (!steps || typeof steps !== 'object') {
                return;
            }
            Object.entries(steps).forEach(([weekId, value]) => {
                const number = Number(value);
                if (!Number.isFinite(number)) {
                    return;
                }
                const current = Number(mergedSteps[weekId] || 1);
                if (number > current) {
                    mergedSteps[weekId] = number;
                }
            });
        });
        if (Object.keys(mergedSteps).length) {
            merged.stepProgressByWeek = mergedSteps;
        }
        merged.updatedAt = Math.max(positiveInt(left.updatedAt), positiveInt(right.updatedAt));
        const currentWeek = pickCurrentWeekId(left.currentWeekId, right.currentWeekId);
        if (currentWeek) {
            merged.currentWeekId = currentWeek;
        }
        const firstLogins = [positiveInt(left.firstLoginAt), positiveInt(right.firstLoginAt)].filter((value) => value > 0);
        if (firstLogins.length) {
            merged.firstLoginAt = Math.min(...firstLogins);
        }
        const completed = mergeWeekCompletedAt(left.weekCompletedAt, right.weekCompletedAt);
        if (Object.keys(completed).length) {
            merged.weekCompletedAt = completed;
        }
        const notes = mergeNotes(left.notes, right.notes);
        if (Object.keys(notes).length) {
            merged.notes = notes;
        }
        return merged;
    }

    function applyMergedSnapshot(merged) {
        state.notes = merged.notes && typeof merged.notes === 'object' ? { ...merged.notes } : {};
        state.exerciseStatusByWeek = (
            merged.exerciseStatusByWeek && typeof merged.exerciseStatusByWeek === 'object'
        ) ? merged.exerciseStatusByWeek : {};
        state.stepProgressByWeek = (
            merged.stepProgressByWeek && typeof merged.stepProgressByWeek === 'object'
        ) ? merged.stepProgressByWeek : {};
        state.exerciseDraftsByWeek = (
            merged.exerciseDraftsByWeek && typeof merged.exerciseDraftsByWeek === 'object'
        ) ? merged.exerciseDraftsByWeek : {};
        state.weekCompletedAt = (
            merged.weekCompletedAt && typeof merged.weekCompletedAt === 'object'
        ) ? merged.weekCompletedAt : {};
        state.firstLoginAt = positiveInt(merged.firstLoginAt) || state.firstLoginAt || Date.now();
        state.updatedAt = positiveInt(merged.updatedAt);

        const candidateWeek = String(merged.currentWeekId || '').trim();
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
            const summary = getWeekExerciseSummary(week.id);
            if (summary.isUnlocked && !state.weekCompletedAt[week.id]) {
                state.weekCompletedAt[week.id] = Date.now() - EPISODE_UNLOCK_AFTER_COMPLETION_MS - 1000;
            }
        });
    }

    function mergeSnapshot(remoteSnapshot, options = {}) {
        if (!remoteSnapshot || typeof remoteSnapshot !== 'object') {
            return false;
        }
        if (remoteSnapshot.cleared === true || snapshotLooksEmpty(remoteSnapshot)) {
            return false;
        }

        const localSnapshot = {
            notes: state.notes,
            exerciseStatusByWeek: state.exerciseStatusByWeek,
            stepProgressByWeek: state.stepProgressByWeek,
            exerciseDraftsByWeek: state.exerciseDraftsByWeek,
            weekCompletedAt: state.weekCompletedAt,
            firstLoginAt: state.firstLoginAt,
            currentWeekId,
            updatedAt: state.updatedAt
        };
        applyMergedSnapshot(mergeClientState(localSnapshot, remoteSnapshot));
        persist({ emit: options.emit !== false });
        return true;
    }

    function ensureStepProgressCoversCompletedWork() {
        let bumped = false;
        weeks.forEach((week) => {
            const ordered = orderedSectionsForWeek(week);
            const drafts = state.exerciseDraftsByWeek?.[week.id];
            let lastIndex = -1;
            ordered.forEach((section, index) => {
                const evaluation = getExerciseEvaluation(week.id, section.id);
                const hasDraft = Boolean(
                    drafts &&
                    typeof drafts === 'object' &&
                    Object.entries(drafts).some(([key, text]) =>
                        String(key || '').includes(section.id) && String(text || '').trim()
                    )
                );
                if (evaluation || hasDraft) {
                    lastIndex = index;
                }
            });
            if (lastIndex < 0) {
                return;
            }
            const onboardingOffset = String(week.id || '').toLowerCase() === 'week1' ? 1 : 0;
            const needed = onboardingOffset + lastIndex + 1;
            if (needed > getWeekStepProgress(week.id)) {
                state.stepProgressByWeek[week.id] = needed;
                bumped = true;
            }
        });
        if (bumped) {
            touchUpdatedAt();
        }
        persist();
        return bumped;
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
            const progressUnlocked = prevSummary.isUnlocked;
            const failedConditions = [];
            if (!progressUnlocked) {
                failedConditions.push('progress');
                availability.set(week.id, {
                    locked: true,
                    status: 'locked',
                    failedConditions
                });
                return;
            }
            const prevCompletedAtMs = Number(state.weekCompletedAt?.[previousWeek.id]);
            const unlockAtMs = (prevCompletedAtMs > 0 ? prevCompletedAtMs : nowMs) + EPISODE_UNLOCK_AFTER_COMPLETION_MS;
            const timeUnlocked = nowMs >= unlockAtMs;
            if (!timeUnlocked) {
                failedConditions.push('time');
            }
            availability.set(week.id, {
                locked: failedConditions.length > 0,
                status: failedConditions.length > 0 ? 'locked' : 'available',
                failedConditions,
                unlockAt: new Date(unlockAtMs).toISOString()
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
        ensureStepProgressCoversCompletedWork,
        clearPersistedProgress,
        getWeekExerciseSummary,
        getWeekAvailability,
        getOverallProgress
    };
})();

