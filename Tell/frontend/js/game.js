// Game logic functions
// Note: inputAreaShown is defined in init.js and accessible via window.inputAreaShown

function checkAndShowInputArea(messageContent, msgObj) {
    const inputArea = document.getElementById('inputArea');
    if (!inputArea || window.inputAreaShown) return;

    // Episode 1: show input when main menu appears after "Start Investigation!" (this message text)
    if (messageContent && messageContent.trim().startsWith('👥 FOUR PEOPLE ARE IN THE APARTMENT')) {
        inputArea.style.display = 'flex';
        window.inputAreaShown = true;
        if (typeof window.updatePrivateModeControls === 'function') {
            window.updatePrivateModeControls();
        }
        return;
    }
    // Episodes 2–4 (or if user skipped to them before finishing ep1 onboarding): show input when menu is shown
    // Backend sends type "menu" for main menu and sub-menus once investigation has started for that episode
    if (msgObj && msgObj.type === 'menu') {
        inputArea.style.display = 'flex';
        window.inputAreaShown = true;
        if (typeof window.updatePrivateModeControls === 'function') {
            window.updatePrivateModeControls();
        }
    }
}

function displayMessage(msg) {
    // Handle clue messages specially - show in detail drawer
    if (msg.type === 'clue') {
        showClueDetail(
            msg.clue_id,
            msg.content,
            msg.image,
            msg.buttons || [],
            msg.button_note || '',
            msg.clue_name || ''
        );
        return null; // Don't add to chat
    }
    
    // Handle different message types
    const type = msg.type || 'bot';
    
    // Determine sender based on message type
    let sender = 'Game';
    let senderAvatar = null;
    if (type === 'error') {
        sender = 'Error';
    } else if (type === 'system') {
        // For typewriter-style intro messages, show three centered asterisks instead of "System"
        if (msg.typewriter_style) {
            sender = '***';
        } else {
            sender = 'System';
        }
    } else if (type === 'character') {
        // For character messages, use character_name (without emoji)
        sender = msg.character_name || msg.character || 'Character';
        // Use character image if available
        if (msg.character_image) {
            senderAvatar = msg.character_image;
        }
    }
    
    const isNarratorMessage = (
        type === 'character' &&
        (
            (typeof msg.character === 'string' && msg.character.toLowerCase() === 'narrator') ||
            (typeof msg.character_name === 'string' && msg.character_name.toLowerCase().trim() === 'narrator')
        )
    );

    const messageOptions = isNarratorMessage
        ? { messageClass: 'narrator-message', hideSender: true, hideAvatar: true }
        : {};

    const explicitScope = typeof msg.chat_scope === 'string' ? msg.chat_scope.trim().toLowerCase() : '';
    const activeScope = (typeof window.getActiveChatScope === 'function')
        ? window.getActiveChatScope()
        : 'public';
    const senderKey = String(msg.character || '').trim().toLowerCase();
    let chatScope = explicitScope || activeScope || 'public';
    if (!explicitScope && type === 'character') {
        // Keep only active private character replies in private scope; everything else is public.
        const expectedPrivateScope = senderKey ? `private:${senderKey}` : '';
        if (!expectedPrivateScope || !chatScope.startsWith('private:') || chatScope !== expectedPrivateScope) {
            chatScope = 'public';
        } else {
            chatScope = expectedPrivateScope;
        }
    } else if (!explicitScope && type !== 'user') {
        chatScope = 'public';
    }
    messageOptions.chatScope = chatScope;

    if (type === 'character' && senderAvatar && typeof window.openCharacterProfile === 'function') {
        messageOptions.onAvatarClick = () => window.openCharacterProfile({
            name: sender,
            image: senderAvatar
        });
    }

    const messageDiv = addMessage(
        type,
        sender,
        msg.content,
        msg.image,
        senderAvatar,
        msg.typewriter_style,
        messageOptions
    );
    
    // Check if we need to show input area and tutorial
    checkAndShowInputArea(msg.content, msg);
    
    const buttons = Array.isArray(msg.buttons) ? [...msg.buttons] : [];
    const isTutorMessage = (
        (typeof msg.character === 'string' && msg.character.toLowerCase() === 'tutor') ||
        (typeof msg.character_name === 'string' && msg.character_name.toLowerCase().includes('tutor')) ||
        (typeof msg.type === 'string' && msg.type.toLowerCase() === 'language_tutor')
    );
    const hasTutorStyle = (
        typeof msg.message_style === 'string' &&
        msg.message_style.toLowerCase() === 'tutor'
    );
    const isOnboardingWelcomeMessage = (
        type === 'system' &&
        buttons.some(btn => btn.action === 'onboarding_step5')
    );

    if (isTutorMessage || hasTutorStyle || isOnboardingWelcomeMessage) {
        if (messageDiv) {
            messageDiv.classList.add('tutor-message');
        }
    }

    if (isTutorMessage) {
        const hasHideButton = buttons.some(btn => btn.action === 'hide_message');
        if (!hasHideButton) {
            buttons.push({ text: 'Hide this message', action: 'hide_message' });
        }
    }

    if (buttons.length > 0) {
        const buttonRow = document.createElement('div');
        buttonRow.className = 'button-row';

        buttons.forEach(btn => {
            const button = document.createElement('button');
            button.textContent = btn.text;
            if (btn.action === 'hide_message') {
                // Hide the message when hide_message button is clicked
                button.onclick = () => {
                    messageDiv.dataset.userHidden = 'true';
                    if (typeof window.applyChatScopeVisibility === 'function') {
                        window.applyChatScopeVisibility();
                    } else {
                        messageDiv.style.display = 'none';
                        messageDiv.setAttribute('aria-hidden', 'true');
                    }
                };
            } else {
                button.onclick = () => handleAction(btn.action);
            }
            buttonRow.appendChild(button);
        });

        // Insert after the message content
        const messageContent = messageDiv.querySelector('.message-content');
        if (messageContent) {
            messageContent.appendChild(buttonRow);
            if (msg.button_note) {
                const buttonNote = document.createElement('div');
                buttonNote.className = 'button-note';
                buttonNote.textContent = msg.button_note;
                messageContent.appendChild(buttonNote);
            }
        }
    }
    
    return messageDiv;
}

async function displayMessagesSequentially(messages, delay = 0) {
    // Display all messages immediately without delay
    for (const msg of messages) {
        displayMessage(msg);
    }
    if (typeof window.applyChatScopeVisibility === 'function') {
        window.applyChatScopeVisibility();
    }
}

// Export to window
window.displayMessage = displayMessage;
window.displayMessagesSequentially = displayMessagesSequentially;
window.checkAndShowInputArea = checkAndShowInputArea;
