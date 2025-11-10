// Game logic functions
// Note: inputAreaShown is defined in init.js and accessible via window.inputAreaShown

function checkAndShowInputArea(messageContent, msgObj) {
    const inputArea = document.getElementById('inputArea');
    if (!inputArea || window.inputAreaShown) return;
    
    // Check if message starts with "👥 FOUR PEOPLE ARE IN THE APARTMENT"
    if (messageContent && messageContent.trim().startsWith('👥 FOUR PEOPLE ARE IN THE APARTMENT')) {
        // Show input area (but tutorial will start after user clicks "Start Investigation!")
        inputArea.style.display = 'flex';
        window.inputAreaShown = true;
        // Don't start tutorial here - it will start after "start_investigation" action
    }
    // Don't show input area for other messages during onboarding
}

function displayMessage(msg) {
    // Handle clue messages specially - show in detail drawer
    if (msg.type === 'clue') {
        showClueDetail(msg.clue_id, msg.content, msg.image);
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
    
    const messageDiv = addMessage(type, sender, msg.content, msg.image, senderAvatar, msg.typewriter_style);
    
    // Check if we need to show input area and tutorial
    checkAndShowInputArea(msg.content, msg);
    
    const buttons = Array.isArray(msg.buttons) ? [...msg.buttons] : [];
    const isTutorMessage = (
        (typeof msg.character === 'string' && msg.character.toLowerCase() === 'tutor') ||
        (typeof msg.character_name === 'string' && msg.character_name.toLowerCase().includes('tutor')) ||
        (typeof msg.type === 'string' && msg.type.toLowerCase() === 'language_tutor')
    );

    if (isTutorMessage) {
        const hasHideButton = buttons.some(btn => btn.action === 'hide_message');
        if (!hasHideButton) {
            buttons.push({ text: 'Hide this message', action: 'hide_message' });
        }
        if (messageDiv) {
            messageDiv.classList.add('tutor-message');
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
                    messageDiv.style.display = 'none';
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
        }
    }
    
    return messageDiv;
}

async function displayMessagesSequentially(messages, delay = 0) {
    // Display all messages immediately without delay
    for (const msg of messages) {
        displayMessage(msg);
    }
}

// Export to window
window.displayMessage = displayMessage;
window.displayMessagesSequentially = displayMessagesSequentially;
window.checkAndShowInputArea = checkAndShowInputArea;
