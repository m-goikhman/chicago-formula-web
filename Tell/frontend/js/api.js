// API functions
const apiClient = window.apiClient;
if (!apiClient) {
    throw new Error('apiClient must be loaded before Tell API module');
}

function shouldShowNinaFloatingButton() {
    return (window.currentStageNumber || 1) === 1;
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
            
            // Show navigation bar
            const navigationBar = document.getElementById('navigationBar');
            if (navigationBar) {
                navigationBar.style.display = 'flex';
            }
            
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
        const { response, data } = await apiClient.get('/api/game/start', {
            token: sessionToken
        });

        console.log('Response status:', response.status, response.statusText);

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
        
        // Display all messages from backend
        if (data.messages && Array.isArray(data.messages)) {
            await displayMessagesSequentially(data.messages);
        } else {
            addMessage('bot', 'System', 'Game started!');
        }
    } catch (error) {
        console.error('Error loading game:', error);
        removeLoadingMessage();
        addMessage('bot', 'Error', 'Failed to load game: ' + error.message);
    }
}

async function handleAction(action, closeDrawersOnSuccess = true) {
    console.log('Handling action:', action);
    
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
        const { response, data } = await apiClient.postJson('/api/game/action', { action: action }, {
            token: sessionToken
        });
        console.log('Action response:', data);

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
            const ninaButton = document.getElementById('ninaFloatingButton');
            if (ninaButton) {
                ninaButton.style.display = 'flex';
            }
        }

        // Location transitions can change available characters inside the same episode
        if (action.startsWith('go_') && typeof loadEpisodeSelector === 'function') {
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
    }
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();

    if (!text) return;

    // Show user message
    addMessage('user', 'You', text);
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
        const { response, data } = await apiClient.postJson('/api/game/message', { text }, {
            token: sessionToken
        });

        if (!response.ok) {
            const errorMessage = (data && (data.detail || data.error || data.message)) || response.statusText || 'Failed to send message';
            if (typingMsg) typingMsg.remove();
            addMessage('bot', 'Error', errorMessage);
            return;
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
        const { response, data } = await apiClient.postJson('/api/game/explain', {
            action: 'word',
            word: wordOrPhrase,
            original_text: originalText
        }, {
            token: sessionToken
        });

        if (!response.ok) {
            const errorMessage = (data && (data.detail || data.error || data.message)) || response.statusText || 'Failed to get explanation';
            addMessage('error', 'Error', errorMessage);
            return;
        }

        if (data && data.messages && data.messages.length > 0) {
            window.getSelection().removeAllRanges();
            await displayMessagesSequentially(data.messages, 0);
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
    // Clear localStorage
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('participantCode');
    
    // Clear session variables
    sessionToken = '';
    participantCode = '';
    currentCharacter = null;
    
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
        
        const { response, data } = await apiClient.get('/api/game/start', {
            token: sessionToken
        });
        
        if (response.ok) {
            // Token is valid, restore UI
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('gameScreen').classList.add('active');
            
            // Show navigation bar
            const navigationBar = document.getElementById('navigationBar');
            if (navigationBar) {
                navigationBar.style.display = 'flex';
            }
            
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
            
            // Load episode selector
            await loadEpisodeSelector();
            
            // Load game
            await loadGame();
            
            // Show Nina floating button if investigation has started (character messages or menu visible)
            const ninaButton = document.getElementById('ninaFloatingButton');
            if (ninaButton && navigationBar && navigationBar.style.display !== 'none' && shouldShowNinaFloatingButton()) {
                const chatArea = document.getElementById('chatArea');
                if (chatArea) {
                    const hasCharacterMessages = chatArea.querySelectorAll('.message.character').length > 0;
                    const hasMenuMessage = chatArea.querySelectorAll('.message.menu').length > 0;
                    if (hasCharacterMessages || hasMenuMessage) {
                        ninaButton.style.display = 'flex';
                    }
                }
            }
            
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
        const { response, data } = await apiClient.postJson('/api/game/nina', { text }, {
            token: sessionToken
        });
        
        // Remove typing indicator
        typingDiv.remove();
        
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
        const { response, data } = await apiClient.get('/api/game/stages', {
            token: sessionToken
        });
        
        if (!response.ok) {
            console.error('Failed to load stages');
            return;
        }
        
        const stagesInfo = data.stages_info || [];
        const currentStage = data.current_stage || 1;
        const availableStages = data.available_stages || [1];
        window.currentStageNumber = currentStage;
        
        // Set current episode's characters for drawer and typing indicator (before any early return)
        const currentStageInfo = stagesInfo.find(s => s.stage === currentStage);
        window.currentStageCharacters = currentStageInfo?.characters || [];
        window.allCharacters = (currentStageInfo?.characters || []).map(c => ({ name: c.full_name, image: c.image }));
        if (window.populateCharactersDrawer) window.populateCharactersDrawer();

        const ninaButton = document.getElementById('ninaFloatingButton');
        if (ninaButton) {
            ninaButton.style.display = shouldShowNinaFloatingButton() ? 'flex' : 'none';
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
        const { response, data } = await apiClient.postJson('/api/game/stage/switch', {
            stage_number: stageNumber
        }, {
            token: sessionToken
        });
        
        if (!response.ok) {
            alert('Failed to switch episode. Please try again.');
            return;
        }
        
        // Reload episode selector
        await loadEpisodeSelector();
        
        // Clear chat so only the selected episode's messages will be shown
        const chatArea = document.getElementById('chatArea');
        if (chatArea) {
            chatArea.innerHTML = '';
        }
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
window.loadEpisodeSelector = loadEpisodeSelector;
window.switchEpisode = switchEpisode;
