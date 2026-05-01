(() => {
    const menuEl = document.getElementById('horizontalMenu');
    const chatArea = document.getElementById('chatArea');
    const overallChipEl = document.getElementById('overallProgressChip');
    const overallProgressBarEl = document.getElementById('overallProgressBar');
    const progressSubbandEl = document.querySelector('.progress-subband');
    const burgerButton = document.getElementById('burgerButton');
    const appContainer = document.getElementById('teachApp');

    const loginScreen = document.getElementById('loginScreen');
    const loginInput = document.getElementById('participantCode');
    const loginButton = document.getElementById('loginBtn');
    const loginError = document.getElementById('loginError');

    const TeachAuth = window.TeachAuth;
    const TeachOpenEndedLogger = window.TeachOpenEndedLogger;
    const apiClient = window.apiClient;
    const uiShared = window.uiShared || {};

    let notesSaveTimer = null;
    let notesStatusEl = null;
    let appInitialized = false;

    const defaultLoginButtonLabel = loginButton ? loginButton.textContent : 'Start Reading Journey';

    function formatPercent(completed, total) {
        if (!total) {
            return '0%';
        }
        return `${Math.round((completed / total) * 100)}%`;
    }

    async function showProgressReport() {
        if (!apiClient || !TeachAuth) {
            window.alert('Progress report is temporarily unavailable.');
            return;
        }

        const token = TeachAuth.getToken?.();
        if (!token) {
            window.alert('Please sign in again to view your progress report.');
            return;
        }

        try {
            const requestFn = () => apiClient.get('/api/teach/progress-report', { token });
            const { response, data } = TeachAuth.callWithSessionRecovery
                ? await TeachAuth.callWithSessionRecovery(requestFn, {
                    authFailureMessage: 'Your session expired. Please sign in again to view your progress report.'
                })
                : await requestFn();

            if (!response?.ok) {
                throw new Error(data?.detail || data?.error || data?.message || 'Unable to load progress report.');
            }

            const report = String(data?.report || '').trim();
            if (!report) {
                window.alert('No progress report is available yet.');
                return;
            }

            const addMessage = typeof uiShared.addMessage === 'function' ? uiShared.addMessage : null;
            if (!addMessage) {
                window.alert(report);
                return;
            }

            const messageDiv = addMessage('system', 'Mentor', report);
            if (!messageDiv) {
                return;
            }

            const messageContent = messageDiv.querySelector('.message-content');
            if (!messageContent) {
                return;
            }

            const buttonRow = document.createElement('div');
            buttonRow.className = 'button-row';

            const hideButton = document.createElement('button');
            hideButton.type = 'button';
            hideButton.textContent = 'Hide this message';
            hideButton.addEventListener('click', () => {
                messageDiv.style.display = 'none';
            });

            buttonRow.appendChild(hideButton);
            messageContent.appendChild(buttonRow);
        } catch (error) {
            console.error('[TeachApp] Failed to load progress report:', error);
            window.alert('Could not load your progress report right now. Please try again.');
        }
    }

    function showTeachHelp() {
        window.alert(
            [
                'How to play:',
                '1. Pick an episode from the dropdown under the title.',
                '2. Read sections and complete tasks step-by-step.',
                '3. Mark tasks complete to track progress.',
            ].join('\n')
        );
    }

    function resetTeachHistory() {
        const confirmed = window.confirm('Reset all Teach progress and notes for all episodes?');
        if (!confirmed) {
            return;
        }
        localStorage.removeItem(window.TEACH_CONFIG.TEACH_PROGRESS_STORAGE_KEY);
        window.location.reload();
    }

    function handleHorizontalMenuAction(action) {
        TeachUI.closeMenu();
        switch (action) {
            case 'language_menu_difficulty':
                window.alert('Language Level controls are not yet available in Teach mode.');
                break;
            case 'language_menu_progress':
                showProgressReport();
                break;
            case 'help':
                showTeachHelp();
                break;
            case 'reset_all_history':
                resetTeachHistory();
                break;
            case 'logout':
                if (TeachAuth && typeof TeachAuth.logout === 'function') {
                    TeachAuth.logout();
                }
                window.location.reload();
                break;
            default:
                break;
        }
    }

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
        const overallProgress = TeachState.getOverallProgress();
        const ratio = overallProgress.total > 0 ? overallProgress.completed / overallProgress.total : 0;
        const pct = Math.round(ratio * 100);
        if (overallChipEl) {
            overallChipEl.textContent = `${pct}%`;
        }
        if (overallProgressBarEl) {
            overallProgressBarEl.style.width = `${pct}%`;
        }
    }

    function showErrorState(message) {
        TeachUI.setChatLoading(chatArea, message);
    }

    function render() {
        const weeks = TeachState.getWeeks();
        const currentWeek = TeachState.getCurrentWeek();

        TeachUI.renderWeekSelector(weeks, TeachState.getCurrentWeekId(), {
            onSelect: handleWeekSelect
        });

        if (!currentWeek) {
            showErrorState('No weeks found. Add markdown content to the Teach folder to get started.');
            updateOverallChip();
            return;
        }

        const weekProgress = TeachState.getWeekProgress(currentWeek.id);
        if (notesSaveTimer) {
            clearTimeout(notesSaveTimer);
            notesSaveTimer = null;
        }
        notesStatusEl = null;

        TeachUI.renderWeekContent(chatArea, currentWeek, {
            isTaskCompleted: (taskId) => TeachState.isTaskCompleted(currentWeek.id, taskId),
            onTaskToggle: handleTaskToggle,
            participantCode: TeachAuth?.getParticipantCode?.() || '',
            notesValue: TeachState.getNotes(currentWeek.id),
            weekProgress,
            onNotesReady: ({ notesTextarea, notesStatusEl: statusEl }) => {
                notesStatusEl = statusEl || null;
                updateNotesStatus('Autosaved');
                attachNotesHandler(notesTextarea, currentWeek.id);
            }
        });

        updateOverallChip();
    }

    async function startTeachApp() {
        if (appInitialized) {
            render();
            return;
        }
        appInitialized = true;

        TeachUI.setChatLoading(chatArea);
        try {
            const weeks = await loadTeachContent();
            TeachState.initialize(weeks);
            render();
        } catch (error) {
            console.error('[TeachApp] Failed to initialise Teach mode:', error);
            showErrorState('We could not load the detective course content. Please try reloading the page.');
        }
    }

    function showLoginScreen() {
        if (loginScreen) {
            loginScreen.style.display = 'flex';
        }
        if (progressSubbandEl) {
            progressSubbandEl.style.display = 'none';
        }
        if (appContainer) {
            appContainer.classList.remove('active');
        }
        clearLoginMessages();
        setLoginLoading(false);
    }

    function showAppContainer() {
        if (loginScreen) {
            loginScreen.style.display = 'none';
        }
        if (progressSubbandEl) {
            progressSubbandEl.style.display = '';
        }
        if (appContainer) {
            appContainer.classList.add('active');
        }
    }

    function setLoginLoading(isLoading) {
        if (loginButton) {
            loginButton.disabled = isLoading;
            loginButton.textContent = isLoading ? 'Checking…' : defaultLoginButtonLabel;
        }
        if (loginInput) {
            loginInput.disabled = isLoading;
        }
    }

    function clearLoginMessages() {
        if (loginError) {
            loginError.textContent = '';
        }
    }

    async function handleLoginSubmit(event) {
        if (event) {
            event.preventDefault();
        }

        if (!TeachAuth) {
            console.warn('[TeachApp] TeachAuth is not available.');
            return;
        }

        const rawCode = loginInput?.value?.trim();
        if (!rawCode) {
            if (loginError) {
                loginError.textContent = 'Enter your participant code.';
            }
            return;
        }

        clearLoginMessages();
        setLoginLoading(true);

        try {
            await TeachAuth.login(rawCode);
            if (loginInput) {
                loginInput.value = '';
            }
            showAppContainer();
            await startTeachApp();
        } catch (error) {
            console.error('[TeachApp] Login failed:', error);
            if (loginError) {
                loginError.textContent = error?.message || 'Sign-in failed. Please try again.';
            }
        } finally {
            setLoginLoading(false);
        }
    }

    function attachEventListeners() {
        if (loginButton) {
            loginButton.addEventListener('click', handleLoginSubmit);
        }

        if (loginInput) {
            loginInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    handleLoginSubmit(event);
                }
            });
        }

        if (burgerButton && TeachUI.toggleMenu) {
            burgerButton.addEventListener('click', () => {
                TeachUI.toggleMenu();
            });
        }

        if (menuEl) {
            menuEl.addEventListener('click', (event) => {
                const menuItem = event.target.closest('[data-menu-action]');
                if (!menuItem) {
                    return;
                }
                const action = menuItem.dataset.menuAction;
                if (!action) {
                    return;
                }
                handleHorizontalMenuAction(action);
            });
        }

        if (TeachOpenEndedLogger && typeof TeachOpenEndedLogger.setup === 'function') {
            TeachOpenEndedLogger.setup(chatArea, () => TeachState.getCurrentWeekId());
        }

    }

    async function bootstrap() {
        attachEventListeners();

        if (!TeachAuth) {
            console.warn('[TeachApp] TeachAuth not available, skipping login check.');
            showAppContainer();
            await startTeachApp();
            return;
        }

        const restored = await TeachAuth.restoreSession();
        if (restored) {
            showAppContainer();
            await startTeachApp();
        } else {
            showLoginScreen();
            if (loginInput) {
                setTimeout(() => loginInput.focus(), 50);
            }
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        bootstrap();
    });
})();

