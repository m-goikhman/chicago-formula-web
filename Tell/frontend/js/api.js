// API functions
const apiClient = window.apiClient;
if (!apiClient) {
    throw new Error('apiClient must be loaded before Tell API module');
}

function shouldShowNinaFloatingButton() {
    return (window.currentStageNumber || 1) === 1;
}

function hasNinaPublicDialogueStarted() {
    return Boolean(window.ninaPublicDialogueStarted);
}

function syncNinaFloatingButtonVisibility() {
    const ninaButton = document.getElementById('ninaFloatingButton');
    const navigationBar = document.getElementById('navigationBar');
    const inputArea = document.getElementById('inputArea');
    if (!ninaButton) return;

    const navigationVisible = Boolean(navigationBar && navigationBar.style.display !== 'none');
    const inputVisible = Boolean(inputArea && inputArea.style.display !== 'none');
    // Intro is considered finished once either the bottom input is shown
    // or the navigation bar is already unlocked.
    const introCompleted = inputVisible || navigationVisible || Boolean(window.inputAreaShown);
    const shouldShow = shouldShowNinaFloatingButton()
        && introCompleted
        && !window.ep1GameCompleted
        && !hasNinaPublicDialogueStarted();
    ninaButton.style.display = shouldShow ? 'flex' : 'none';
}

function isUnauthorizedResponse(response) {
    return response && response.status === 401;
}

function getAuthErrorMessage(data) {
    if (!data) return '';
    return String(data.detail || data.error || data.message || '').toLowerCase();
}

function isExpiredTokenError(response, data) {
    if (!isUnauthorizedResponse(response)) return false;
    const message = getAuthErrorMessage(data);
    return message.includes('invalid or expired token') || message.includes('expired token') || message.includes('invalid token');
}

async function silentReauthenticate() {
    const code = participantCode || localStorage.getItem('participantCode');
    if (!code) {
        return false;
    }

    try {
        const { response, data } = await apiClient.postJson('/api/auth/login', {
            participant_code: code
        });

        if (!response.ok || !data || !data.token) {
            return false;
        }

        sessionToken = data.token;
        participantCode = data.participant_code || code.toUpperCase();
        localStorage.setItem('sessionToken', sessionToken);
        localStorage.setItem('participantCode', participantCode);
        return true;
    } catch (error) {
        console.error('Silent re-authentication failed:', error);
        return false;
    }
}

function forceReloginWithMessage() {
    const rememberedCode = participantCode || localStorage.getItem('participantCode') || '';
    logout();

    const participantCodeInput = document.getElementById('participantCode');
    if (participantCodeInput && rememberedCode) {
        participantCodeInput.value = rememberedCode;
    }

    const errorDiv = document.getElementById('loginError');
    if (errorDiv) {
        errorDiv.textContent = 'Your session expired after inactivity. Please continue by logging in again.';
    }
}

async function callWithAutoReauth(requestFn) {
    let result = await requestFn();
    if (!isExpiredTokenError(result.response, result.data)) {
        return result;
    }

    const refreshed = await silentReauthenticate();
    if (!refreshed) {
        forceReloginWithMessage();
        return {
            response: result.response,
            data: result.data,
            authFailureHandled: true
        };
    }

    result = await requestFn();
    if (isExpiredTokenError(result.response, result.data)) {
        forceReloginWithMessage();
        return {
            response: result.response,
            data: result.data,
            authFailureHandled: true
        };
    }

    return result;
}

function hasGameNotInitializedError(response, data) {
    if (!response || !response.ok || !data || !Array.isArray(data.messages)) {
        return false;
    }

    return data.messages.some((message) => {
        if (!message || message.type !== 'error') {
            return false;
        }
        const content = String(message.content || '').toLowerCase();
        return content.includes('game not initialized');
    });
}

async function ensureGameInitialized() {
    const { response, authFailureHandled } = await callWithAutoReauth(() => apiClient.get('/api/game/start', {
        token: sessionToken
    }));

    if (authFailureHandled) {
        return false;
    }

    return Boolean(response && response.ok);
}

async function callWithSessionRecovery(requestFn) {
    let result = await callWithAutoReauth(requestFn);
    if (result.authFailureHandled) {
        return result;
    }

    if (!hasGameNotInitializedError(result.response, result.data)) {
        return result;
    }

    const initialized = await ensureGameInitialized();
    if (!initialized) {
        forceReloginWithMessage();
        return {
            response: result.response,
            data: result.data,
            authFailureHandled: true
        };
    }

    result = await callWithAutoReauth(requestFn);
    return result;
}

function updateResetHistoryMenuVisibility() {
    const resetMenuItem = document.getElementById('resetHistoryMenuItem');
    if (!resetMenuItem) return;
    resetMenuItem.style.display = (participantCode || '').toUpperCase() === 'TEST' ? 'block' : 'none';
}

function getNavigationUnlockedStorageKey() {
    const code = (participantCode || '').trim().toUpperCase();
    return code ? `navigation_unlocked_${code}` : '';
}

function isNavigationUnlocked() {
    const storageKey = getNavigationUnlockedStorageKey();
    if (!storageKey) return false;
    return localStorage.getItem(storageKey) === 'true';
}

function setNavigationUnlocked(unlocked) {
    const storageKey = getNavigationUnlockedStorageKey();
    if (!storageKey) return;
    if (unlocked) {
        localStorage.setItem(storageKey, 'true');
    } else {
        localStorage.removeItem(storageKey);
    }
}

const TELL_CHAT_SCROLL_PREFIX = 'tell_chat_scroll_v1:';

function tellChatScrollStorageKey() {
    const code = (participantCode || localStorage.getItem('participantCode') || '').trim().toUpperCase();
    return code ? `${TELL_CHAT_SCROLL_PREFIX}${code}` : '';
}

function clearTellChatScrollPosition() {
    const key = tellChatScrollStorageKey();
    if (key) {
        sessionStorage.removeItem(key);
    }
}

function saveTellChatScrollPosition() {
    const key = tellChatScrollStorageKey();
    if (!key) {
        return;
    }
    const chatArea = document.getElementById('chatArea');
    if (!chatArea) {
        return;
    }
    const max = chatArea.scrollHeight - chatArea.clientHeight;
    if (max <= 0) {
        sessionStorage.setItem(key, JSON.stringify({ atBottom: true }));
        return;
    }
    const atBottom = chatArea.scrollTop >= max - 8;
    if (atBottom) {
        sessionStorage.setItem(key, JSON.stringify({ atBottom: true }));
        return;
    }
    sessionStorage.setItem(key, JSON.stringify({ atBottom: false, ratio: chatArea.scrollTop / max }));
}

function restoreTellChatScrollPosition() {
    const key = tellChatScrollStorageKey();
    const chatArea = document.getElementById('chatArea');
    if (!chatArea) {
        return;
    }
    if (!key) {
        chatArea.scrollTop = chatArea.scrollHeight;
        return;
    }
    let parsed = null;
    try {
        parsed = JSON.parse(sessionStorage.getItem(key) || '');
    } catch {
        parsed = null;
    }
    const max = Math.max(0, chatArea.scrollHeight - chatArea.clientHeight);
    if (!parsed || parsed.atBottom) {
        chatArea.scrollTop = chatArea.scrollHeight;
        return;
    }
    if (typeof parsed.ratio === 'number' && Number.isFinite(parsed.ratio)) {
        chatArea.scrollTop = Math.min(max, Math.max(0, Math.round(parsed.ratio * max)));
    } else {
        chatArea.scrollTop = chatArea.scrollHeight;
    }
}

let tellChatScrollSaveTimer = null;
function scheduleTellChatScrollSave() {
    if (tellChatScrollSaveTimer) {
        clearTimeout(tellChatScrollSaveTimer);
    }
    tellChatScrollSaveTimer = setTimeout(() => {
        tellChatScrollSaveTimer = null;
        saveTellChatScrollPosition();
    }, 200);
}

function initTellChatScrollPersistence() {
    const chatArea = document.getElementById('chatArea');
    if (!chatArea || chatArea.dataset.tellScrollListen === '1') {
        return;
    }
    chatArea.dataset.tellScrollListen = '1';
    chatArea.addEventListener('scroll', scheduleTellChatScrollSave, { passive: true });
}

window.addEventListener('pagehide', () => {
    saveTellChatScrollPosition();
});

function updateNavigationBarVisibility() {
    const navigationBar = document.getElementById('navigationBar');
    if (!navigationBar) return;
    navigationBar.style.display = isNavigationUnlocked() ? 'flex' : 'none';
    syncNinaFloatingButtonVisibility();
}

function resolveCharacterFromTalkAction(action) {
    const actionText = String(action || '').trim().toLowerCase();
    if (!actionText.startsWith('talk_')) {
        return null;
    }

    const characterKey = actionText.slice(5);
    if (!characterKey) {
        return null;
    }

    const stageCharacters = Array.isArray(window.currentStageCharacters) ? window.currentStageCharacters : [];
    const matched = stageCharacters.find((character) => (character?.key || '').toLowerCase() === characterKey);

    if (matched) {
        return {
            key: matched.key || characterKey,
            name: matched.full_name,
            image: matched.image || null
        };
    }

    // Fallback: still switch private scope even when stage metadata is stale.
    const fallbackName = characterKey
        ? characterKey.charAt(0).toUpperCase() + characterKey.slice(1)
        : 'Character';
    return {
        key: characterKey,
        name: fallbackName,
        image: null
    };
}

function syncDialogueModeUI() {
    if (typeof window.setActiveCharacterDrawerItem === 'function') {
        window.setActiveCharacterDrawerItem(currentCharacter ? currentCharacter.name : null);
    }
    if (typeof window.updatePrivateModeControls === 'function') {
        window.updatePrivateModeControls();
    }
}

async function login() {
    const code = document.getElementById('participantCode').value;
    const errorDiv = document.getElementById('loginError');
    const loginBtn = document.getElementById('loginBtn');

    if (!code) {
        errorDiv.textContent = 'Please enter a participant code';
        return;
    }

    loginBtn.disabled = true;
    loginBtn.innerHTML = 'Logging in...';

    try {
        const { response, data } = await apiClient.postJson('/api/auth/login', {
            participant_code: code
        });

        const payload = data || {};

        if (response.ok) {
            sessionToken = payload.token;
            participantCode = payload.participant_code;
            
            // Save to localStorage for persistence
            localStorage.setItem('sessionToken', sessionToken);
            localStorage.setItem('participantCode', participantCode);
            
            // Hide login, show game
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('gameScreen').classList.add('active');
            updateResetHistoryMenuVisibility();
            
            // Show navigation only after first main-menu choice
            updateNavigationBarVisibility();
            window.ninaPublicDialogueStarted = false;
            syncNinaFloatingButtonVisibility();
            
            // Show Nina floating button after investigation starts
            // It will be shown when investigation actually begins
            
            // Populate drawers
            if (window.populateCharactersDrawer) {
                window.populateCharactersDrawer();
            }
            if (window.populateCaseMaterialsDrawer) {
                window.populateCaseMaterialsDrawer();
            }
            
            // Activate "Everyone" by default (public mode)
            currentCharacter = null;
            const firstDrawerItem = document.querySelector('.drawer-item');
            if (firstDrawerItem) {
                firstDrawerItem.classList.add('active');
            }
            syncDialogueModeUI();
            
            // Load episode selector
            await loadEpisodeSelector();
            
            // Load game
            loadGame();
        } else {
            errorDiv.textContent = (payload && payload.detail) || 'Login failed';
            loginBtn.disabled = false;
            loginBtn.innerHTML = 'Start Game';
        }
    } catch (error) {
        errorDiv.textContent = 'Connection error. Is the backend running?';
        loginBtn.disabled = false;
        loginBtn.innerHTML = 'Start Game';
    }
}

async function loadGame() {
    // Helper function to remove loading message
    const removeLoadingMessage = () => {
        const loadingMessage = document.getElementById('loadingMessage');
        if (loadingMessage) {
            loadingMessage.remove();
        }
    };
    
    try {
        console.log('Loading game with token:', sessionToken ? 'Token exists' : 'No token');
        console.log('API URL:', API_URL);
        
        // Load game normally - tutorial will be triggered after specific message
        const { response, data, authFailureHandled } = await callWithAutoReauth(() => apiClient.get('/api/game/start', {
            token: sessionToken
        }));

        console.log('Response status:', response.status, response.statusText);
        if (authFailureHandled) {
            removeLoadingMessage();
            return;
        }

        if (!response.ok) {
            const errorText = (data && (data.detail || data.error || data.message)) || response.statusText || 'Unknown error';
            console.error('Failed to load game:', response.status, errorText);
            removeLoadingMessage();
            addMessage('bot', 'Error', `Failed to load game (${response.status}): ${errorText}`);
            return;
        }

        console.log('Game data received:', data);
        
        // Remove the loading message
        removeLoadingMessage();
        
        // Display all messages from backend (instant: full history from server, e.g. after reload)
        if (data.messages && Array.isArray(data.messages)) {
            await displayMessagesSequentially(data.messages, 0, { instant: true });
            restoreTellChatScrollPosition();
            requestAnimationFrame(() => {
                restoreTellChatScrollPosition();
            });
        } else {
            addMessage('bot', 'System', 'Game started!');
        }
        syncNinaFloatingButtonVisibility();
    } catch (error) {
        console.error('Error loading game:', error);
        removeLoadingMessage();
        addMessage('bot', 'Error', 'Failed to load game: ' + error.message);
        syncNinaFloatingButtonVisibility();
    }
}

async function handleAction(action, closeDrawersOnSuccess = true, selectedOptionText = '') {
    console.log('Handling action:', action);
    const normalizedAction = String(action || '').trim().toLowerCase();
    const normalizedSelectedOptionText = String(selectedOptionText || '').trim();

    // Frontend-only: show the button label as the player's line; no API or other side effects.
    if (normalizedAction === 'say_as_user') {
        if (normalizedSelectedOptionText) {
            const currentChatScope = (typeof window.getActiveChatScope === 'function')
                ? window.getActiveChatScope()
                : 'public';
            addMessage('user', 'You', normalizedSelectedOptionText, null, null, false, { chatScope: currentChatScope });
        }
        return;
    }

    if (normalizedAction.startsWith('accuse_') && normalizedSelectedOptionText) {
        const currentChatScope = (typeof window.getActiveChatScope === 'function')
            ? window.getActiveChatScope()
            : 'public';
        addMessage('user', 'You', normalizedSelectedOptionText, null, null, false, { chatScope: currentChatScope });
    }

    if (
        (normalizedAction === 'ep1_outro_narrator' || normalizedAction === 'outro_questionnaire')
        && normalizedSelectedOptionText
    ) {
        const currentChatScope = (typeof window.getActiveChatScope === 'function')
            ? window.getActiveChatScope()
            : 'public';
        addMessage('user', 'You', normalizedSelectedOptionText, null, null, false, { chatScope: currentChatScope });
    }

    if (normalizedAction === 'mode_public') {
        currentCharacter = null;
        syncDialogueModeUI();
    } else if (normalizedAction.startsWith('talk_')) {
        const targetCharacter = resolveCharacterFromTalkAction(normalizedAction);
        if (targetCharacter) {
            currentCharacter = targetCharacter;
            syncDialogueModeUI();
        }
    }

    // Open side drawers directly from chat menu without backend roundtrip.
    if (action === 'menu_talk') {
        setNavigationUnlocked(true);
        updateNavigationBarVisibility();
        syncNinaFloatingButtonVisibility();
        if (typeof window.openLeftDrawer === 'function') {
            window.openLeftDrawer();
        } else if (typeof window.toggleLeftDrawer === 'function') {
            window.toggleLeftDrawer();
        }
        return;
    }

    if (action === 'menu_evidence') {
        setNavigationUnlocked(true);
        updateNavigationBarVisibility();
        syncNinaFloatingButtonVisibility();
        if (typeof window.openRightDrawer === 'function') {
            window.openRightDrawer();
        } else if (typeof window.toggleRightDrawer === 'function') {
            window.toggleRightDrawer();
        }
        return;
    }

    if (action === 'reset_all_history') {
        const confirmed = window.confirm(
            'This will delete all message history and progress across all episodes for TEST. Continue?'
        );
        if (!confirmed) {
            return;
        }

        try {
            const { response, data, authFailureHandled } = await callWithAutoReauth(() => apiClient.postJson('/api/game/reset', {}, {
                token: sessionToken
            }));

            if (authFailureHandled) {
                return;
            }

            if (!response.ok) {
                const errorMessage = (data && (data.detail || data.error || data.message)) || response.statusText || 'Failed to reset history';
                addMessage('error', 'Error', errorMessage);
                return;
            }

            const chatArea = document.getElementById('chatArea');
            if (chatArea) {
                chatArea.innerHTML = '';
            }
            clearTellChatScrollPosition();
            window.inputAreaShown = false;
            const inputArea = document.getElementById('inputArea');
            if (inputArea) {
                inputArea.style.display = 'none';
            }
            syncDialogueModeUI();

            await loadEpisodeSelector();
            await loadGame();
            return;
        } catch (error) {
            console.error('Error resetting history:', error);
            addMessage('error', 'Error', 'Failed to reset history');
            return;
        }
    }
    
    // Special handling for language level adjustments - hide text and show spinner inside message
    let loadingMsg = null;
    let oldIntroMessage = null;
    const isLanguageAdjustment = action === 'language_adjust_easier' || action === 'language_adjust_more_advanced';
    
    if (isLanguageAdjustment) {
        // Find the last typewriter-intro message
        const chatArea = document.getElementById('chatArea');
        const typewriterMessages = chatArea.querySelectorAll('.message.typewriter-intro');
        if (typewriterMessages.length > 0) {
            oldIntroMessage = typewriterMessages[typewriterMessages.length - 1];
            const messageText = oldIntroMessage.querySelector('.message-text');
            const messageContent = oldIntroMessage.querySelector('.message-content');
            
            if (messageText && messageContent) {
                // Hide the text
                messageText.style.display = 'none';
                
                // Remove buttons if present
                const buttonRow = oldIntroMessage.querySelector('.button-row');
                if (buttonRow) {
                    buttonRow.style.display = 'none';
                }
                
                // Create loading spinner inside the message content
                const loadingDiv = document.createElement('div');
                loadingDiv.className = 'loading-spinner-container';
                loadingDiv.innerHTML = '<div class="loading-spinner"></div><span>Switching language level...</span>';
                messageContent.appendChild(loadingDiv);
                loadingMsg = loadingDiv;
                
                chatArea.scrollTop = chatArea.scrollHeight;
            }
        }
    } else {
        loadingMsg = addMessage('bot', 'Loading', 'Processing...');
    }
    
    try {
        const { response, data, authFailureHandled } = await callWithSessionRecovery(() => apiClient.postJson('/api/game/action', { action: action }, {
            token: sessionToken
        }));
        console.log('Action response:', data);
        if (authFailureHandled) {
            if (isLanguageAdjustment && oldIntroMessage) {
                const messageText = oldIntroMessage.querySelector('.message-text');
                const buttonRow = oldIntroMessage.querySelector('.button-row');
                const loadingContainer = oldIntroMessage.querySelector('.loading-spinner-container');
                if (messageText) messageText.style.display = '';
                if (buttonRow) buttonRow.style.display = '';
                if (loadingContainer && loadingContainer.parentNode) {
                    loadingContainer.parentNode.removeChild(loadingContainer);
                }
            } else if (loadingMsg) {
                if (loadingMsg.remove) {
                    loadingMsg.remove();
                } else if (loadingMsg.parentNode) {
                    loadingMsg.parentNode.removeChild(loadingMsg);
                }
            }
            return;
        }

        if (!response.ok) {
            if (isLanguageAdjustment && oldIntroMessage) {
                const messageText = oldIntroMessage.querySelector('.message-text');
                const buttonRow = oldIntroMessage.querySelector('.button-row');
                const loadingContainer = oldIntroMessage.querySelector('.loading-spinner-container');

                if (messageText) {
                    messageText.style.display = '';
                }
                if (buttonRow) {
                    buttonRow.style.display = '';
                }
                if (loadingContainer && loadingContainer.parentNode) {
                    loadingContainer.parentNode.removeChild(loadingContainer);
                }
            } else if (loadingMsg) {
                if (loadingMsg.remove) {
                    loadingMsg.remove();
                } else if (loadingMsg.parentNode) {
                    loadingMsg.parentNode.removeChild(loadingMsg);
                }
            }

            const errorMessage = (data && (data.detail || data.error || data.message)) || response.statusText || 'Failed to process action';
            addMessage('error', 'Error', errorMessage);
            return;
        }
        
        // For language adjustments, wait 1.5 seconds before showing new message
        if (isLanguageAdjustment && oldIntroMessage) {
            // Wait 1.5 seconds
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // Remove the old message
            if (oldIntroMessage.parentNode) {
                oldIntroMessage.parentNode.removeChild(oldIntroMessage);
            }
        } else if (loadingMsg) {
            if (loadingMsg.remove) {
                loadingMsg.remove();
            } else if (loadingMsg.parentNode) {
                loadingMsg.parentNode.removeChild(loadingMsg);
            }
        }
        
        // Close drawers on success
        if (closeDrawersOnSuccess) {
            closeAllDrawers();
        }
        
        // Show Nina floating button when investigation starts (last intro step sends case_intro_next, backend returns menu)
        const investigationJustStarted = (
            action === 'start_investigation' ||
            action.startsWith('go_') ||
            (action === 'case_intro_next' && data.messages && data.messages.some(m => m.type === 'menu'))
        );
        if (investigationJustStarted && shouldShowNinaFloatingButton()) {
            syncNinaFloatingButtonVisibility();
        }

        // Some actions can change available characters inside the same episode.
        // Refresh stage info so "Who's here" is immediately in sync.
        if (
            (action.startsWith('go_') || normalizedAction === 'pauline_entrance_doorway' || normalizedAction === 'pauline_entrance_doorway.txt')
            && typeof loadEpisodeSelector === 'function'
        ) {
            await loadEpisodeSelector();
        }

        // Tutorial: show when investigation has just started
        if (investigationJustStarted) {
            const tutorialCompleted = localStorage.getItem(`tutorial_completed_${participantCode}`);
            if (!tutorialCompleted) {
                // Initialize and show tutorial after a delay to let messages appear
                initTutorial();
                setTimeout(() => {
                    tutorialResumed = false; // Reset flag for automatic flow
                    showTutorialStep(0);
                }, 1500); // Delay to let investigation messages appear first
            }
        }
        
        // Display response messages
        if (data.messages && Array.isArray(data.messages)) {
            await displayMessagesSequentially(data.messages);
            // Input area will be shown automatically by checkAndShowInputArea
            // when the "👥 FOUR PEOPLE ARE IN THE APARTMENT" message appears
        } else if (data.detail) {
            // Handle error messages from backend
            addMessage('error', 'Error', data.detail);
        }
        syncNinaFloatingButtonVisibility();
    } catch (error) {
        // If it was a language adjustment, restore the old message
        if (isLanguageAdjustment && oldIntroMessage) {
            const messageText = oldIntroMessage.querySelector('.message-text');
            const buttonRow = oldIntroMessage.querySelector('.button-row');
            const loadingContainer = oldIntroMessage.querySelector('.loading-spinner-container');
            
            if (messageText) {
                messageText.style.display = '';
            }
            if (buttonRow) {
                buttonRow.style.display = '';
            }
            if (loadingContainer && loadingContainer.parentNode) {
                loadingContainer.parentNode.removeChild(loadingContainer);
            }
        } else if (loadingMsg) {
            if (loadingMsg.remove) {
                loadingMsg.remove();
            } else if (loadingMsg.parentNode) {
                loadingMsg.parentNode.removeChild(loadingMsg);
            }
        }
        console.error('Error handling action:', error);
        addMessage('error', 'Error', 'Failed to process action');
        syncNinaFloatingButtonVisibility();
    }
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();

    if (!text) return;

    // Show user message in the active chat scope.
    const currentChatScope = (typeof window.getActiveChatScope === 'function')
        ? window.getActiveChatScope()
        : 'public';
    addMessage('user', 'You', text, null, null, false, { chatScope: currentChatScope });
    input.value = '';
    
    // Reset textarea height
    input.style.height = 'auto';

    // Show typing indicator
    let typingMsg = null;
    
    // Determine current character for typing indicator
    let characterForTyping = currentCharacter;
    
    // Use current episode's characters when set by loadEpisodeSelector, else config fallback
    const charactersForTyping = (window.allCharacters && window.allCharacters.length) ? window.allCharacters : allCharacters;
    
    if (!characterForTyping) {
        const activeDrawerItem = document.querySelector('.drawer-item.active');
        if (activeDrawerItem) {
            const charName = activeDrawerItem.querySelector('.name')?.textContent;
            if (charName && charName !== 'Everyone') {
                const charData = charactersForTyping.find(c => c.name === charName);
                if (charData) characterForTyping = charData;
            }
        }
    }
    
    if (characterForTyping) {
        typingMsg = showTypingIndicator(characterForTyping);
    } else if (charactersForTyping.length) {
        const randomCharacter = charactersForTyping[Math.floor(Math.random() * charactersForTyping.length)];
        typingMsg = showTypingIndicator(randomCharacter);
    }

    try {
        const { response, data, authFailureHandled } = await callWithSessionRecovery(() => apiClient.postJson('/api/game/message', { text }, {
            token: sessionToken
        }));

        if (authFailureHandled) {
            if (typingMsg) typingMsg.remove();
            return;
        }

        if (!response.ok) {
            const errorMessage = (data && (data.detail || data.error || data.message)) || response.statusText || 'Failed to send message';
            if (typingMsg) typingMsg.remove();
            addMessage('bot', 'Error', errorMessage);
            return;
        }

        if (typingMsg) {
            typingMsg.remove();
            typingMsg = null;
        }

        if (data && data.messages && Array.isArray(data.messages)) {
            await displayMessagesSequentially(data.messages);
        } else if (data && data.message) {
            addMessage('bot', 'Game', data.message);
        }

        if (typingMsg) typingMsg.remove();
    } catch (error) {
        if (typingMsg) typingMsg.remove();
        addMessage('bot', 'Error', 'Failed to send message');
    }
}

async function explainWord(wordOrPhrase, originalText) {
    try {
        const activeChatScope = (typeof window.getActiveChatScope === 'function')
            ? window.getActiveChatScope()
            : 'public';
        const { response, data, authFailureHandled } = await callWithSessionRecovery(() => apiClient.postJson('/api/game/explain', {
            action: 'word',
            word: wordOrPhrase,
            original_text: originalText
        }, {
            token: sessionToken
        }));

        if (authFailureHandled) {
            return;
        }

        if (!response.ok) {
            const errorMessage = (data && (data.detail || data.error || data.message)) || response.statusText || 'Failed to get explanation';
            addMessage('error', 'Error', errorMessage);
            return;
        }

        if (data && data.messages && data.messages.length > 0) {
            const scopedMessages = data.messages.map((msg) => {
                if (!msg || typeof msg !== 'object') {
                    return msg;
                }
                const hasExplicitScope = typeof msg.chat_scope === 'string' && msg.chat_scope.trim().length > 0;
                return hasExplicitScope ? msg : { ...msg, chat_scope: activeChatScope };
            });
            window.getSelection().removeAllRanges();
            await displayMessagesSequentially(scopedMessages, 0);
        } else if (data && data.error) {
            addMessage('error', 'Error', data.error);
        }
    } catch (error) {
        console.error('Error explaining word:', error);
        addMessage('error', 'Error', 'Failed to get explanation');
    }
}

// Logout function
function logout() {
    const previousParticipantCode = participantCode;

    // Clear localStorage
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('participantCode');
    if (previousParticipantCode) {
        localStorage.removeItem(`navigation_unlocked_${previousParticipantCode.toUpperCase()}`);
        sessionStorage.removeItem(`${TELL_CHAT_SCROLL_PREFIX}${previousParticipantCode.toUpperCase()}`);
    }
    
    // Clear session variables
    sessionToken = '';
    participantCode = '';
    currentCharacter = null;
    syncDialogueModeUI();
    updateResetHistoryMenuVisibility();
    
    // Hide game screen, show login screen
    document.getElementById('gameScreen').classList.remove('active');
    document.getElementById('loginScreen').style.display = 'flex';
    
    // Hide navigation bar
    const navigationBar = document.getElementById('navigationBar');
    if (navigationBar) {
        navigationBar.style.display = 'none';
    }
    
    // Hide Nina floating button
    const ninaButton = document.getElementById('ninaFloatingButton');
    if (ninaButton) {
        ninaButton.style.display = 'none';
    }
    window.ninaPublicDialogueStarted = false;
    
    // Close Nina chat if open
    closeNinaChat();
    
    // Clear chat area
    const chatArea = document.getElementById('chatArea');
    if (chatArea) {
        chatArea.innerHTML = '';
    }
    
    // Hide input area
    const inputArea = document.getElementById('inputArea');
    if (inputArea) {
        inputArea.style.display = 'none';
    }
    syncDialogueModeUI();
    
    // Close all drawers
    if (window.closeAllDrawers) {
        window.closeAllDrawers();
    }
    
    // Close burger menu if open
    const menu = document.getElementById('horizontalMenu');
    const button = document.getElementById('burgerButton');
    if (menu && menu.classList.contains('active')) {
        menu.classList.remove('active');
        button.classList.remove('active');
    }
    
    // Reset input area shown flag
    window.inputAreaShown = false;
    
    // Clear participant code input
    const participantCodeInput = document.getElementById('participantCode');
    if (participantCodeInput) {
        participantCodeInput.value = '';
    }
}

// Restore session from localStorage
async function restoreSession() {
    const savedToken = localStorage.getItem('sessionToken');
    const savedCode = localStorage.getItem('participantCode');
    
    if (!savedToken || !savedCode) {
        return false;
    }
    
    // Verify token is still valid by trying to load game
    try {
        sessionToken = savedToken;
        participantCode = savedCode;
        
        const { response, data } = await callWithAutoReauth(() => apiClient.get('/api/game/start', {
            token: sessionToken
        }));
        
        if (response.ok) {
            // Token is valid, restore UI
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('gameScreen').classList.add('active');
            updateResetHistoryMenuVisibility();
            
            // Show navigation only after first main-menu choice
            updateNavigationBarVisibility();
            syncNinaFloatingButtonVisibility();
            
            // Populate drawers
            if (window.populateCharactersDrawer) {
                window.populateCharactersDrawer();
            }
            if (window.populateCaseMaterialsDrawer) {
                window.populateCaseMaterialsDrawer();
            }
            
            // Activate "Everyone" by default (public mode)
            currentCharacter = null;
            const firstDrawerItem = document.querySelector('.drawer-item');
            if (firstDrawerItem) {
                firstDrawerItem.classList.add('active');
            }
            syncDialogueModeUI();
            
            // Load episode selector
            await loadEpisodeSelector();
            
            // Load game
            await loadGame();
            syncNinaFloatingButtonVisibility();
            
            return true;
        } else {
            // Token expired or invalid, clear storage
            localStorage.removeItem('sessionToken');
            localStorage.removeItem('participantCode');
            return false;
        }
    } catch (error) {
        console.error('Error restoring session:', error);
        // On error, clear storage and show login
        localStorage.removeItem('sessionToken');
        localStorage.removeItem('participantCode');
        return false;
    }
}

// Nina chat functions
function openNinaChat() {
    const modal = document.getElementById('ninaChatModal');
    if (modal) {
        modal.style.display = 'flex';
        // Focus on input
        const input = document.getElementById('ninaChatInput');
        if (input) {
            setTimeout(() => input.focus(), 100);
        }
    }
}

function closeNinaChat() {
    const modal = document.getElementById('ninaChatModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function sendNinaMessage() {
    const input = document.getElementById('ninaChatInput');
    const sendBtn = document.getElementById('ninaChatSendBtn');
    const messagesContainer = document.getElementById('ninaChatMessages');
    
    if (!input || !sendBtn || !messagesContainer) return;
    
    const text = input.value.trim();
    if (!text) return;
    
    // Disable input and button
    input.disabled = true;
    sendBtn.disabled = true;
    
    // Show user message
    const userMessageDiv = document.createElement('div');
    userMessageDiv.className = 'nina-chat-message user';
    userMessageDiv.innerHTML = `
        <div class="nina-chat-message-content">${text}</div>
    `;
    messagesContainer.appendChild(userMessageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    // Clear input
    input.value = '';
    input.style.height = 'auto';
    
    // Show typing indicator
    const typingDiv = document.createElement('div');
    typingDiv.className = 'nina-chat-message nina';
    typingDiv.innerHTML = `
        <img src="https://teach-tell-backend-801526931549.europe-west4.run.app/api/images/nina.png" alt="Nina" class="nina-chat-message-avatar">
        <div class="nina-chat-message-content">Nina is typing...</div>
    `;
    messagesContainer.appendChild(typingDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    try {
        const { response, data, authFailureHandled } = await callWithSessionRecovery(() => apiClient.postJson('/api/game/nina', { text }, {
            token: sessionToken
        }));
        
        // Remove typing indicator
        typingDiv.remove();
        if (authFailureHandled) {
            return;
        }
        
        if (!response.ok) {
            const errorMessage = (data && (data.detail || data.error || data.message)) || response.statusText || 'Failed to send message';
            const errorDiv = document.createElement('div');
            errorDiv.className = 'nina-chat-message nina';
            errorDiv.innerHTML = `
                <img src="https://teach-tell-backend-801526931549.europe-west4.run.app/api/images/nina.png" alt="Nina" class="nina-chat-message-avatar">
                <div class="nina-chat-message-content" style="color: #d32f2f;">Error: ${errorMessage}</div>
            `;
            messagesContainer.appendChild(errorDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            return;
        }
        
        // Display Nina's response
        if (data && data.messages && Array.isArray(data.messages)) {
            for (const msg of data.messages) {
                const ninaMessageDiv = document.createElement('div');
                ninaMessageDiv.className = 'nina-chat-message nina';
                
                // Render markdown content
                const content = renderMarkdownForNina(msg.content || '');
                
                ninaMessageDiv.innerHTML = `
                    <img src="https://teach-tell-backend-801526931549.europe-west4.run.app/api/images/nina.png" alt="Nina" class="nina-chat-message-avatar">
                    <div class="nina-chat-message-content">${content}</div>
                `;
                messagesContainer.appendChild(ninaMessageDiv);
            }
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    } catch (error) {
        // Remove typing indicator
        typingDiv.remove();
        
        const errorDiv = document.createElement('div');
        errorDiv.className = 'nina-chat-message nina';
        errorDiv.innerHTML = `
            <img src="https://teach-tell-backend-801526931549.europe-west4.run.app/api/images/nina.png" alt="Nina" class="nina-chat-message-avatar">
            <div class="nina-chat-message-content" style="color: #d32f2f;">Error: Failed to send message</div>
        `;
        messagesContainer.appendChild(errorDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } finally {
        // Re-enable input and button
        input.disabled = false;
        sendBtn.disabled = false;
        input.focus();
    }
}

// Use the shared markdown renderer if available
function renderMarkdownForNina(text) {
    if (!text) return '';
    
    // Use the shared renderMarkdown function if available
    if (window.uiShared && typeof window.uiShared.renderMarkdown === 'function') {
        return window.uiShared.renderMarkdown(text);
    }
    
    // Fallback: simple markdown renderer
    // Escape HTML first
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    // Bold **text**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    
    // Italic *text*
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    
    return html;
}

function appendNinaModalMessage(msg = {}) {
    const messagesContainer = document.getElementById('ninaChatMessages');
    if (!messagesContainer) return;

    const ninaMessageDiv = document.createElement('div');
    const isUserMessage = String(msg.type || '').toLowerCase() === 'user';
    ninaMessageDiv.className = `nina-chat-message ${isUserMessage ? 'user' : 'nina'}`;

    const content = renderMarkdownForNina(msg.content || '');
    if (isUserMessage) {
        ninaMessageDiv.innerHTML = `
            <div class="nina-chat-message-content">${content}</div>
        `;
    } else {
        ninaMessageDiv.innerHTML = `
            <img src="https://teach-tell-backend-801526931549.europe-west4.run.app/api/images/nina.png" alt="Nina" class="nina-chat-message-avatar">
            <div class="nina-chat-message-content">${content}</div>
        `;
    }

    const buttons = Array.isArray(msg.buttons) ? msg.buttons : [];
    if (buttons.length > 0) {
        const contentEl = ninaMessageDiv.querySelector('.nina-chat-message-content');
        if (contentEl) {
            const buttonRow = document.createElement('div');
            buttonRow.className = 'button-row';
            buttonRow.style.marginTop = '10px';
            const disableButtonRowOnce = () => {
                if (buttonRow.dataset.disabled === 'true') return;
                buttonRow.dataset.disabled = 'true';
                const rowButtons = buttonRow.querySelectorAll('button');
                rowButtons.forEach((b) => {
                    b.disabled = true;
                    b.style.pointerEvents = 'none';
                });
                buttonRow.style.display = 'none';
            };
            buttons.forEach((btn) => {
                const button = document.createElement('button');
                button.textContent = btn.text;
                button.onclick = () => {
                    disableButtonRowOnce();
                    handleAction(btn.action, true, btn.text);
                };
                buttonRow.appendChild(button);
            });
            contentEl.appendChild(buttonRow);
        }
    }

    messagesContainer.appendChild(ninaMessageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Handle Enter key in Nina chat input
document.addEventListener('DOMContentLoaded', function() {
    const ninaInput = document.getElementById('ninaChatInput');
    if (ninaInput) {
        ninaInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendNinaMessage();
            }
        });
        
        // Auto-resize textarea
        ninaInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 100) + 'px';
        });
    }
    
    // Close modal when clicking outside
    const ninaModal = document.getElementById('ninaChatModal');
    if (ninaModal) {
        ninaModal.addEventListener('click', function(e) {
            if (e.target === ninaModal) {
                closeNinaChat();
            }
        });
    }
});

// Episode selector functions
async function loadEpisodeSelector() {
    try {
        const { response, data, authFailureHandled } = await callWithAutoReauth(() => apiClient.get('/api/game/stages', {
            token: sessionToken
        }));
        
        if (authFailureHandled) {
            return;
        }
        
        if (!response.ok) {
            console.error('Failed to load stages');
            return;
        }
        
        const stagesInfo = data.stages_info || [];
        const currentStage = data.current_stage || 1;
        const availableStages = data.available_stages || [1];
        window.currentStageNumber = currentStage;
        window.ep1GameCompleted = Boolean(data.game_completed);
        window.ep1UsbDriveUnlocked = Boolean(data.ep1_usb_drive_unlocked);
        
        // Set current episode's characters for drawer and typing indicator (before any early return)
        const currentStageInfo = stagesInfo.find(s => s.stage === currentStage);
        window.currentStageCharacters = currentStageInfo?.characters || [];
        window.currentStageLocations = currentStageInfo?.locations || [];
        window.allCharacters = (currentStageInfo?.characters || []).map(c => ({ name: c.full_name, image: c.image }));
        if (window.populateCharactersDrawer) window.populateCharactersDrawer();
        if (window.populateCaseMaterialsDrawer) window.populateCaseMaterialsDrawer();
        if (typeof window.applyEp1CaseClosedUi === 'function') window.applyEp1CaseClosedUi();
        if (window.renderLocationSwitcher) {
            window.renderLocationSwitcher(currentStageInfo || { stage: currentStage, locations: [] });
        }

        const ninaButton = document.getElementById('ninaFloatingButton');
        if (ninaButton) {
            // Keep hidden until investigation actually starts.
            ninaButton.style.display = 'none';
        }
        
        const episodeDisplay = document.getElementById('episodeDisplay');
        const episodeSelector = document.getElementById('episodeSelector');
        const episodeDropdown = document.getElementById('episodeDropdown');
        if (!episodeDisplay || !episodeSelector || !episodeDropdown) {
            return;
        }
        
        episodeDisplay.textContent = `Episode ${currentStage}`;
        
        if (availableStages.length <= 1) {
            episodeSelector.classList.remove('has-dropdown');
            episodeDropdown.style.display = 'none';
            episodeDisplay.style.cursor = 'default';
            return;
        }
        
        // Show dropdown functionality
        episodeSelector.classList.add('has-dropdown');
        episodeDisplay.style.cursor = 'pointer';
        
        // Populate dropdown
        episodeDropdown.innerHTML = '';
        stagesInfo.forEach(stageInfo => {
            const item = document.createElement('div');
            item.className = 'episode-dropdown-item';
            
            if (stageInfo.current) {
                item.classList.add('current');
            }
            
            if (stageInfo.completed) {
                item.classList.add('completed');
            }
            
            if (!stageInfo.available) {
                item.classList.add('locked');
            }
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'episode-name';
            nameSpan.textContent = `Episode ${stageInfo.stage}: ${stageInfo.name}`;
            
            const statusSpan = document.createElement('span');
            statusSpan.className = 'episode-status';
            if (stageInfo.completed) {
                statusSpan.textContent = 'Completed';
            } else if (stageInfo.current) {
                statusSpan.textContent = 'Current';
            } else if (!stageInfo.available) {
                statusSpan.textContent = 'Locked';
            } else {
                statusSpan.textContent = 'Available';
            }
            
            item.appendChild(nameSpan);
            item.appendChild(statusSpan);
            
            if (stageInfo.available && !stageInfo.locked) {
                item.onclick = () => switchEpisode(stageInfo.stage);
            }
            
            episodeDropdown.appendChild(item);
        });
        
        // Toggle dropdown on click
        episodeDisplay.onclick = (e) => {
            e.stopPropagation();
            episodeSelector.classList.toggle('dropdown-open');
            if (episodeSelector.classList.contains('dropdown-open')) {
                episodeDropdown.style.display = 'block';
            } else {
                episodeDropdown.style.display = 'none';
            }
        };
        
        // Close dropdown when clicking outside
        document.addEventListener('click', function closeDropdownOnOutsideClick(e) {
            if (!episodeSelector.contains(e.target)) {
                episodeSelector.classList.remove('dropdown-open');
                episodeDropdown.style.display = 'none';
            }
        });
        
    } catch (error) {
        console.error('Error loading episode selector:', error);
    }
}

async function switchEpisode(stageNumber) {
    try {
        const { response, data, authFailureHandled } = await callWithAutoReauth(() => apiClient.postJson('/api/game/stage/switch', {
            stage_number: stageNumber
        }, {
            token: sessionToken
        }));

        if (authFailureHandled) {
            return;
        }
        
        if (!response.ok) {
            alert('Failed to switch episode. Please try again.');
            return;
        }
        
        // Reload episode selector
        await loadEpisodeSelector();
        window.ninaPublicDialogueStarted = false;
        
        // Clear chat so only the selected episode's messages will be shown
        const chatArea = document.getElementById('chatArea');
        if (chatArea) {
            chatArea.innerHTML = '';
        }
        clearTellChatScrollPosition();
        // Show loading while fetching episode messages
        const loadingMessage = document.createElement('div');
        loadingMessage.id = 'loadingMessage';
        loadingMessage.className = 'message bot';
        loadingMessage.innerHTML = '<div class="message-content"><div class="message-sender">Game Bot</div><div>Loading episode...</div></div>';
        chatArea.appendChild(loadingMessage);
        
        // Reload game to show new episode content (messages for this episode only)
        await loadGame();
        
    } catch (error) {
        console.error('Error switching episode:', error);
        alert('Failed to switch episode. Please try again.');
    }
}

// Export to window for HTML compatibility
window.login = login;
window.loadGame = loadGame;
window.handleAction = handleAction;
window.sendMessage = sendMessage;
window.explainWord = explainWord;
window.logout = logout;
window.restoreSession = restoreSession;
window.openNinaChat = openNinaChat;
window.closeNinaChat = closeNinaChat;
window.sendNinaMessage = sendNinaMessage;
window.appendNinaModalMessage = appendNinaModalMessage;
window.loadEpisodeSelector = loadEpisodeSelector;
window.switchEpisode = switchEpisode;
window.syncNinaFloatingButtonVisibility = syncNinaFloatingButtonVisibility;
window.initTellChatScrollPersistence = initTellChatScrollPersistence;
