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

function shouldPersistButtonRowAfterClick(action) {
    const normalizedAction = String(action || '').trim().toLowerCase();
    // Keep intro game-menu shortcuts available after click.
    return normalizedAction === 'menu_talk' || normalizedAction === 'menu_evidence';
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

    const isNinaModalTaggedMessage = Boolean(msg?.ui && msg.ui.ninaModalMessage === true);
    const shouldRouteNinaToModal = isNinaModalTaggedMessage;

    if (msg.ui && msg.ui.closeNinaChat === true) {
        window.ninaPublicDialogueStarted = true;
        if (typeof window.closeNinaChat === 'function') {
            window.closeNinaChat();
        }
    }

    if (msg.ui && msg.ui.openNinaChat === true && typeof window.openNinaChat === 'function') {
        window.openNinaChat();
    }
    if (shouldRouteNinaToModal && typeof window.appendNinaModalMessage === 'function') {
        window.appendNinaModalMessage(msg);
        if (typeof window.syncNinaFloatingButtonVisibility === 'function') {
            window.syncNinaFloatingButtonVisibility();
        }
        return null;
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
    const isNarratorStyleRemark = (
        isNarratorMessage ||
        (
            type === 'system' &&
            typeof msg.message_style === 'string' &&
            msg.message_style.toLowerCase() === 'narrator'
        )
    );

    const messageOptions = isNarratorStyleRemark
        ? { messageClass: 'narrator-message', hideSender: true, hideAvatar: true }
        : {};

    const chatScope = resolveMessageChatScope(msg, type);
    messageOptions.chatScope = chatScope;

    if (msg.ui && msg.ui.imageFirst === true) {
        messageOptions.imageFirst = true;
    }

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

    // Backend-driven UI flags (e.g., mode switches, dynamic Case Materials actions).
    if (msg.ui && typeof msg.ui.caseMaterialsAccusationAvailable === 'boolean') {
        window.caseMaterialsAccusationAvailable = msg.ui.caseMaterialsAccusationAvailable;
        if (typeof window.populateCaseMaterialsDrawer === 'function') {
            window.populateCaseMaterialsDrawer();
        }
    }
    if (msg.ui && msg.ui.ep1GameCompleted === true) {
        window.ep1GameCompleted = true;
        window.ninaPublicDialogueStarted = true;
        if (typeof currentCharacter !== 'undefined') {
            currentCharacter = null;
        }
        if (typeof window.setActiveCharacterDrawerItem === 'function') {
            window.setActiveCharacterDrawerItem(null);
        }
        if (typeof window.applyEp1CaseClosedUi === 'function') {
            window.applyEp1CaseClosedUi();
        }
    }
    if (msg.ui && msg.ui.ep1UsbDriveUnlocked === true) {
        window.ep1UsbDriveUnlocked = true;
        if (typeof window.populateCaseMaterialsDrawer === 'function') {
            window.populateCaseMaterialsDrawer();
        }
    }
    if (msg.ui && msg.ui.switchToPublicMode === true) {
        window.ninaPublicDialogueStarted = true;
        if (typeof currentCharacter !== 'undefined') {
            currentCharacter = null;
        }
        if (typeof window.setActiveCharacterDrawerItem === 'function') {
            window.setActiveCharacterDrawerItem(null);
        }
        if (typeof window.updatePrivateModeControls === 'function') {
            window.updatePrivateModeControls();
        }
    }
    if (typeof window.syncNinaFloatingButtonVisibility === 'function') {
        window.syncNinaFloatingButtonVisibility();
    }
    
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
        // Prevent double-clicking different buttons from the same message.
        // In some scenes (e.g. Pauline entrance) this would otherwise allow choosing two conflicting options.
        const disableButtonRowOnce = () => {
            if (buttonRow.dataset.disabled === 'true') return;
            buttonRow.dataset.disabled = 'true';
            const rowButtons = buttonRow.querySelectorAll('button');
            rowButtons.forEach(b => {
                b.disabled = true;
                b.style.pointerEvents = 'none';
            });
            buttonRow.style.display = 'none';
        };

        buttons.forEach(btn => {
            const button = document.createElement('button');
            button.textContent = btn.text;
            if (btn.action === 'hide_message') {
                // Hide the message when hide_message button is clicked
                button.onclick = () => {
                    disableButtonRowOnce();
                    messageDiv.dataset.userHidden = 'true';
                    if (typeof window.applyChatScopeVisibility === 'function') {
                        window.applyChatScopeVisibility();
                    } else {
                        messageDiv.style.display = 'none';
                        messageDiv.setAttribute('aria-hidden', 'true');
                    }
                };
            } else {
                button.onclick = () => {
                    if (!shouldPersistButtonRowAfterClick(btn.action)) {
                        disableButtonRowOnce();
                    }
                    handleAction(btn.action, true, btn.text);
                };
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

async function displayMessagesSequentially(messages, delay = 0, options = {}) {
    const queueMessages = Array.isArray(messages) ? [...messages] : [];
    window.__tellMessageRenderQueue = window.__tellMessageRenderQueue || Promise.resolve();

    const renderTask = async () => {
        await runDisplayMessagesSequentially(queueMessages, delay, options);
    };

    const nextRun = window.__tellMessageRenderQueue.then(renderTask, renderTask);
    window.__tellMessageRenderQueue = nextRun.catch(() => {});
    return nextRun;
}

async function runDisplayMessagesSequentially(messages, delay = 0, options = {}) {
    const instant = Boolean(options && options.instant);
    const interMessageDelay = instant
        ? 0
        : (Number.isFinite(delay) && delay > 0 ? delay : 350);

    for (let i = 0; i < messages.length; i += 1) {
        const msg = messages[i];
        if (!instant) {
            const preDelay = Number(msg?.ui?.preDisplayDelayMs);
            if (Number.isFinite(preDelay) && preDelay > 0) {
                await sleep(preDelay);
            }
            const typingCharacter = resolveTypingCharacterFromMessage(msg);
            if (typingCharacter) {
                const msgType = msg?.type || 'bot';
                const typingScope = resolveMessageChatScope(msg, msgType);
                const typingIndicator = showTypingIndicator(typingCharacter, { chatScope: typingScope });
                await sleep(getTypingDurationMs(msg));
                if (typingIndicator && typeof typingIndicator.remove === 'function') {
                    typingIndicator.remove();
                }
            }
        }

        displayMessage(msg);

        if (!instant && i < messages.length - 1) {
            await sleep(interMessageDelay);
        }
    }
    if (typeof window.applyChatScopeVisibility === 'function') {
        window.applyChatScopeVisibility();
    }
}

function resolveMessageChatScope(msg, type = (msg?.type || 'bot')) {
    const explicitScope = typeof msg?.chat_scope === 'string' ? msg.chat_scope.trim().toLowerCase() : '';
    const activeScope = (typeof window.getActiveChatScope === 'function')
        ? window.getActiveChatScope()
        : 'public';
    const senderKey = String(msg?.character || '').trim().toLowerCase();
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

    return chatScope;
}

function resolveTypingCharacterFromMessage(msg) {
    if (!msg || msg.type !== 'character') {
        return null;
    }

    const fallbackName = msg.character_name || msg.character || 'Character';
    const senderKey = String(msg.character || '').trim().toLowerCase();
    const stageCharacters = Array.isArray(window.currentStageCharacters) ? window.currentStageCharacters : [];
    const matchedStageCharacter = stageCharacters.find((character) => {
        return (character?.key || '').trim().toLowerCase() === senderKey;
    });

    const image = msg.character_image || matchedStageCharacter?.image || null;
    const name = msg.character_name || matchedStageCharacter?.full_name || fallbackName;

    return { name, image, key: senderKey || undefined };
}

function getTypingDurationMs(msg) {
    const contentLength = String(msg?.content || '').trim().length;
    if (!contentLength) {
        return 450;
    }
    return Math.min(1600, 400 + Math.floor(contentLength * 10));
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Export to window
window.displayMessage = displayMessage;
window.displayMessagesSequentially = displayMessagesSequentially;
window.checkAndShowInputArea = checkAndShowInputArea;
