// API functions
const apiClient = window.apiClient;
if (!apiClient) {
    throw new Error('apiClient must be loaded before Tell API module');
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
        
        // Check if this is the "start_investigation" action and tutorial needs to be shown
        if (action === 'start_investigation') {
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
    
    // If currentCharacter is not set, try to get it from active drawer item
    if (!characterForTyping) {
        const activeDrawerItem = document.querySelector('.drawer-item.active');
        if (activeDrawerItem) {
            const charName = activeDrawerItem.querySelector('.name')?.textContent;
            // Check if it's not "Everyone" (public mode)
            if (charName && charName !== 'Everyone') {
                // Find character data from allCharacters array
                const charData = allCharacters.find(c => c.name === charName);
                if (charData) {
                    characterForTyping = charData;
                }
            }
        }
    }
    
    if (characterForTyping) {
        // In private chat, show typing from current character
        typingMsg = showTypingIndicator(characterForTyping);
    } else {
        // In public mode, randomly pick a character who "started typing"
        const randomCharacter = allCharacters[Math.floor(Math.random() * allCharacters.length)];
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
            
            // Load game
            await loadGame();
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

// Export to window for HTML compatibility
window.login = login;
window.loadGame = loadGame;
window.handleAction = handleAction;
window.sendMessage = sendMessage;
window.explainWord = explainWord;
window.logout = logout;
window.restoreSession = restoreSession;
