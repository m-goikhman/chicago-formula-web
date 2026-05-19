// Shared UI helpers
const sharedUI = window.uiShared;
if (!sharedUI) {
    throw new Error('uiShared helpers failed to load before Tell UI script');
}

const {
    escapeHtml,
    renderMarkdown,
    renderTypewriterText,
    addMessage,
    showTypingIndicator,
    autoResizeTextarea,
    buildImageUrl
} = sharedUI;

// Drawer functions
function toggleLeftDrawer() {
    const drawer = document.getElementById('leftDrawer');
    const overlay = document.getElementById('drawerOverlay');
    
    if (drawer.classList.contains('open')) {
        closeLeftDrawer();
    } else {
        closeAllDrawers();
        drawer.classList.add('open');
        overlay.classList.add('active');
    }
}

function openLeftDrawer() {
    const drawer = document.getElementById('leftDrawer');
    const overlay = document.getElementById('drawerOverlay');

    if (!drawer) return;
    closeAllDrawers();
    drawer.classList.add('open');
    if (overlay) {
        overlay.classList.add('active');
    }
}

function closeLeftDrawer() {
    const drawer = document.getElementById('leftDrawer');
    drawer.classList.remove('open');
    checkAndCloseOverlay();
}

function toggleRightDrawer() {
    const drawer = document.getElementById('rightDrawer');
    const overlay = document.getElementById('drawerOverlay');
    
    if (drawer.classList.contains('open')) {
        closeRightDrawer();
    } else {
        closeAllDrawers();
        drawer.classList.add('open');
        overlay.classList.add('active');
    }
}

function openRightDrawer() {
    const drawer = document.getElementById('rightDrawer');
    const overlay = document.getElementById('drawerOverlay');

    if (!drawer) return;
    closeAllDrawers();
    drawer.classList.add('open');
    if (overlay) {
        overlay.classList.add('active');
    }
}

function closeRightDrawer() {
    const drawer = document.getElementById('rightDrawer');
    drawer.classList.remove('open');
    checkAndCloseOverlay();
}

function closeRightDrawerDetail() {
    const drawer = document.getElementById('rightDrawerDetail');
    drawer.style.display = 'none';
    drawer.classList.remove('open'); // Remove open class before checking overlay
    checkAndCloseOverlay();
}

function backToClueList() {
    const detailDrawer = document.getElementById('rightDrawerDetail');
    const listDrawer = document.getElementById('rightDrawer');
    
    // Hide detail drawer
    detailDrawer.style.display = 'none';
    detailDrawer.classList.remove('open');
    
    // Show list drawer
    listDrawer.classList.add('open');
    
    // Ensure overlay is active
    const overlay = document.getElementById('drawerOverlay');
    overlay.classList.add('active');
}

function showClueDetail(clueId, content, imageUrl, clueButtons = [], buttonNote = '', clueName = '') {
    // Hide the list drawer
    const listDrawer = document.getElementById('rightDrawer');
    listDrawer.classList.remove('open');
    
    // Show the detail drawer
    const detailDrawer = document.getElementById('rightDrawerDetail');
    const title = document.getElementById('detailTitle');
    const contentDiv = document.getElementById('clueDetailContent');
    
    const resolvedClueName = (clueName || '').trim() || `Clue ${clueId}`;
    title.textContent = `🔍 ${resolvedClueName}`;
    
    let html = '';
    const clueImageUrl = buildImageUrl(imageUrl);
    if (clueImageUrl) {
        html += `<img src="${clueImageUrl}" alt="Clue ${clueId}" class="clue-detail-image" loading="lazy" onclick="openImageModal('${imageUrl}')" />`;
    }
    html += `<div class="clue-detail-text">${renderMarkdown(content)}</div>`;
    
    contentDiv.innerHTML = html;

    if (Array.isArray(clueButtons) && clueButtons.length > 0) {
        const buttonRow = document.createElement('div');
        buttonRow.className = 'button-row';

        clueButtons.forEach(btn => {
            const button = document.createElement('button');
            button.textContent = btn.text;
            button.onclick = () => handleAction(btn.action, true, btn.text);
            buttonRow.appendChild(button);
        });

        contentDiv.appendChild(buttonRow);

        if (buttonNote) {
            const noteDiv = document.createElement('div');
            noteDiv.className = 'button-note';
            noteDiv.textContent = buttonNote;
            contentDiv.appendChild(noteDiv);
        }
    }

    detailDrawer.style.display = 'flex';
    detailDrawer.classList.add('open');
    
    // Ensure overlay is active
    const overlay = document.getElementById('drawerOverlay');
    overlay.classList.add('active');
}

function closeAllDrawers() {
    closeLeftDrawer();
    closeRightDrawer();
    closeRightDrawerDetail();
}

function checkAndCloseOverlay() {
    const overlay = document.getElementById('drawerOverlay');
    const leftDrawer = document.getElementById('leftDrawer');
    const rightDrawer = document.getElementById('rightDrawer');
    const rightDrawerDetail = document.getElementById('rightDrawerDetail');
    
    const isLeftOpen = leftDrawer.classList.contains('open');
    const isRightOpen = rightDrawer.classList.contains('open');
    const isRightDetailOpen = rightDrawerDetail.classList.contains('open') && rightDrawerDetail.style.display !== 'none';
    
    if (!isLeftOpen && !isRightOpen && !isRightDetailOpen) {
        overlay.classList.remove('active');
    }
}

// Populate characters drawer (uses current episode's characters from API when available)
function populateCharactersDrawer() {
    const charactersList = document.getElementById('charactersList');
    if (!charactersList) return;
    
    // Use current episode's characters from API, or fallback to ep1 list for first paint / restore
    const stageChars = window.currentStageCharacters || [];
    const privateCharacters = stageChars.length > 0
        ? stageChars.map(c => ({ name: c.full_name, status: 'Private Chat', action: `talk_${c.key}`, image: c.image }))
        : [
            { name: 'Tim Kane', status: 'Private Chat', action: 'talk_tim', image: 'ep1/tim.png' },
            { name: 'Ronnie Snapper', status: 'Private Chat', action: 'talk_ronnie', image: 'ep1/ronnie.png' },
            { name: 'Fiona McAllister', status: 'Private Chat', action: 'talk_fiona', image: 'ep1/fiona.png' },
            { name: 'Pauline Thompson', status: 'Private Chat', action: 'talk_pauline', image: 'ep1/pauline.png' }
        ];
    const list = (privateCharacters.length > 1
        ? [{ name: 'Everyone', status: 'Public Chat', action: 'mode_public', image: null }]
        : []
    ).concat(privateCharacters);

    const ep1CaseClosed = Number(window.currentStageNumber || 1) === 1 && Boolean(window.ep1GameCompleted);

    charactersList.innerHTML = '';
    list.forEach(char => {
        const item = document.createElement('div');
        item.className = 'drawer-item';
        item.classList.add(char.action === 'mode_public' ? 'chat-target-public' : 'chat-target-private');
        const isPrivateLocked = ep1CaseClosed && char.action !== 'mode_public';
        if (isPrivateLocked) {
            item.classList.add('drawer-item-disabled');
            item.style.opacity = '0.45';
            item.style.pointerEvents = 'none';
            item.setAttribute('aria-disabled', 'true');
        }
        let iconHTML = '';
        const characterImageUrl = buildImageUrl(char.image);
        if (characterImageUrl) {
            iconHTML = `<img src="${characterImageUrl}" alt="${char.name}" loading="lazy" />`;
        } else {
            iconHTML = char.name === 'Everyone' ? '💬' : `<span class="drawer-item-initial">${(char.name || '?')[0]}</span>`;
        }
        
        item.innerHTML = `
            <div class="drawer-item-icon">${iconHTML}</div>
            <div class="drawer-item-text">
                <div class="name">${char.name}</div>
                <div class="status">${char.status}</div>
            </div>
        `;
        if (!isPrivateLocked) {
            item.onclick = async () => {
                document.querySelectorAll('.drawer-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                
                if (char.name === 'Everyone') {
                    currentCharacter = null;
                } else {
                    const keyFromAction = String(char.action || '').toLowerCase().startsWith('talk_')
                        ? String(char.action).slice(5).toLowerCase()
                        : null;
                    currentCharacter = { name: char.name, image: char.image, key: keyFromAction };
                }
                updatePrivateModeControls();
                
                const isMobile = window.innerWidth <= 767;
                if (isMobile) closeLeftDrawer();
                await handleAction(char.action, !isMobile);
            };
        }
        charactersList.appendChild(item);
    });

    updatePrivateModeControls();
}

function setActiveCharacterDrawerItem(characterName = null) {
    const drawerItems = document.querySelectorAll('#charactersList .drawer-item');
    if (!drawerItems.length) return;

    drawerItems.forEach((item) => item.classList.remove('active'));

    const normalizedTarget = (characterName || '').trim().toLowerCase();
    const targetItem = Array.from(drawerItems).find((item) => {
        const itemName = (item.querySelector('.name')?.textContent || '').trim().toLowerCase();
        if (normalizedTarget) {
            return itemName === normalizedTarget;
        }
        return itemName === 'everyone';
    });

    if (targetItem) {
        targetItem.classList.add('active');
    }
}

function resolveActiveDrawerCharacterKey() {
    const activeDrawer = document.querySelector('#charactersList .drawer-item.active');
    if (!activeDrawer || activeDrawer.classList.contains('chat-target-public')) {
        return '';
    }

    const drawerName = (activeDrawer.querySelector('.name')?.textContent || '').trim().toLowerCase();
    if (!drawerName || drawerName === 'everyone') {
        return '';
    }

    const stageCharacters = Array.isArray(window.currentStageCharacters) ? window.currentStageCharacters : [];
    const matched = stageCharacters.find((character) => {
        const fullName = (character?.full_name || '').trim().toLowerCase();
        return fullName && fullName === drawerName;
    });
    return (matched?.key || '').trim().toLowerCase();
}

function resolveCurrentCharacterKey() {
    if (currentCharacter?.key) {
        return String(currentCharacter.key).trim().toLowerCase();
    }

    const currentName = (currentCharacter?.name || '').trim().toLowerCase();
    if (currentName) {
        const stageCharacters = Array.isArray(window.currentStageCharacters) ? window.currentStageCharacters : [];
        const matched = stageCharacters.find((character) => {
            const fullName = (character?.full_name || '').trim().toLowerCase();
            return fullName && fullName === currentName;
        });
        const matchedKey = (matched?.key || '').trim().toLowerCase();
        if (matchedKey) {
            return matchedKey;
        }
    }

    return resolveActiveDrawerCharacterKey();
}

function getActiveChatScope() {
    const activeKey = resolveCurrentCharacterKey();
    return activeKey ? `private:${activeKey}` : 'public';
}

function applyChatScopeVisibility() {
    const chatArea = document.getElementById('chatArea');
    if (!chatArea) return;

    const activeScope = getActiveChatScope();
    const messages = chatArea.querySelectorAll('.message');
    messages.forEach((messageElement) => {
        const isHiddenByUser = messageElement.dataset.userHidden === 'true';
        const scope = (messageElement.dataset.chatScope || 'public').trim().toLowerCase();
        const isPrivateMessage = scope.startsWith('private:');
        const shouldHideByScope = activeScope === 'public'
            ? isPrivateMessage
            : scope !== activeScope;

        const shouldHide = isHiddenByUser || shouldHideByScope;
        messageElement.style.display = shouldHide ? 'none' : 'flex';
        messageElement.setAttribute('aria-hidden', shouldHide ? 'true' : 'false');
    });
}

function updatePrivateModeControls() {
    const privateModeControls = document.getElementById('privateModeControls');
    if (!privateModeControls) return;
    const mainChatArea = document.querySelector('.main-chat-area');
    const headerModeContext = document.getElementById('chatModeHeaderContext');
    const loginScreen = document.getElementById('loginScreen');
    const inputArea = document.getElementById('inputArea');
    const inputElement = document.getElementById('messageInput');
    const headerContextAvatar = document.getElementById('chatModeHeaderAvatar');
    const backToCommonDialogueBtn = document.getElementById('backToCommonDialogueBtn');
    const isLoginVisible = Boolean(loginScreen && loginScreen.style.display !== 'none');
    const isInputVisible = Boolean(inputArea && inputArea.style.display !== 'none');
    const activeDrawerNameRaw = (
        document.querySelector('#charactersList .drawer-item.active .name')?.textContent || ''
    ).trim();
    const activeDrawerName = activeDrawerNameRaw.toLowerCase();
    const activeCharacterNameRaw = (currentCharacter?.name || '').trim();
    const activeCharacterName = activeCharacterNameRaw.toLowerCase();
    const isPrivateModeActive = Boolean(
        activeCharacterName &&
        activeDrawerName &&
        activeDrawerName !== 'everyone' &&
        activeDrawerName === activeCharacterName
    );
    const privateCharacterLabel = activeCharacterNameRaw || activeDrawerNameRaw;
    const publicAvatarUrl = buildImageUrl('ep1/suspects.png');
    const privateAvatarUrl = buildImageUrl(currentCharacter?.image);
    const currentStage = Number(window.currentStageNumber || 1);
    const navigationBar = document.getElementById('navigationBar');
    const hasInvestigationStarted = Boolean(navigationBar && navigationBar.style.display !== 'none');
    const shouldShowEp1PublicAvatar = currentStage === 1 && hasInvestigationStarted;
    const ep1CaseClosed = currentStage === 1 && Boolean(window.ep1GameCompleted);

    privateModeControls.style.display = isPrivateModeActive && isInputVisible ? 'flex' : 'none';
    if (backToCommonDialogueBtn) {
        backToCommonDialogueBtn.classList.toggle('is-private', isPrivateModeActive);
    }
    if (headerContextAvatar) {
        const avatarSrc = isPrivateModeActive && privateAvatarUrl
            ? privateAvatarUrl
            : (shouldShowEp1PublicAvatar ? publicAvatarUrl : null);
        if (avatarSrc) {
            headerContextAvatar.src = avatarSrc;
            headerContextAvatar.style.display = 'block';
            headerContextAvatar.alt = isPrivateModeActive
                ? `${privateCharacterLabel} avatar`
                : 'Group chat avatar';
        } else {
            headerContextAvatar.src = '';
            headerContextAvatar.alt = '';
            headerContextAvatar.style.display = 'none';
        }
    }
    if (headerModeContext) {
        const shouldShowHeaderContext = !isLoginVisible && Boolean(
            (isPrivateModeActive && privateAvatarUrl) || (!isPrivateModeActive && shouldShowEp1PublicAvatar)
        );
        headerModeContext.style.display = shouldShowHeaderContext ? 'inline-flex' : 'none';
        headerModeContext.classList.toggle('is-private', isPrivateModeActive);
        headerModeContext.title = isPrivateModeActive
            ? `Private chat with ${privateCharacterLabel}`
            : 'Public chat (Everyone)';
    }
    if (inputElement) {
        if (ep1CaseClosed && isInputVisible) {
            inputElement.disabled = true;
            inputElement.placeholder = 'The case is closed — you can read the chat above.';
        } else {
            inputElement.disabled = false;
            if (isInputVisible) {
                inputElement.placeholder = isPrivateModeActive
                    ? `Message ${privateCharacterLabel}...`
                    : 'Type a message to everyone...';
            }
        }
    }
    if (mainChatArea) {
        mainChatArea.classList.toggle('chat-mode-private', isPrivateModeActive);
        mainChatArea.classList.toggle('chat-mode-public', !isPrivateModeActive);
    }

    applyChatScopeVisibility();
}

async function backToCommonDialogue() {
    if (!currentCharacter) return;
    currentCharacter = null;
    setActiveCharacterDrawerItem(null);
    updatePrivateModeControls();

    const isMobile = window.innerWidth <= 767;
    await handleAction('mode_public', !isMobile);
}

// Populate case materials drawer
function populateCaseMaterialsDrawer() {
    const materialsList = document.getElementById('caseMaterialsList');
    const currentStage = window.currentStageNumber || 1;
    const showAccusationButton = currentStage === 1;
    const materials = currentStage === 2
        ? [{ emoji: '🔍', name: 'The Formula', action: 'examine_ep2_clue_1' }]
        : currentStage === 1
            ? (() => {
                const base = [
                    { emoji: '🔍', name: 'Med Report & Personal Items', action: 'examine_clue_1' },
                    { emoji: '🔍', name: 'The Weapon', action: 'examine_clue_2' },
                    { emoji: '🔍', name: 'The Note', action: 'examine_clue_3' }
                ];
                if (window.ep1UsbDriveUnlocked) {
                    return [{ emoji: '🔍', name: 'The USB Drive', action: 'examine_clue_4' }, ...base];
                }
                return base;
            })()
            : [
                { emoji: '🔍', name: 'Med Report & Personal Items', action: 'examine_clue_1' },
                { emoji: '🔍', name: 'The Weapon', action: 'examine_clue_2' },
                { emoji: '🔍', name: 'The Note', action: 'examine_clue_3' },
                { emoji: '🔍', name: 'The Apartment', action: 'examine_clue_4' }
            ];

    // EP1 simplification: Arrest Order is available until the episode is definitively closed.
    const ep1Finished = showAccusationButton && Boolean(window.ep1GameCompleted);
    if (showAccusationButton && !ep1Finished) {
        if (Array.isArray(materials)) {
            materials.push({ emoji: '⚖️', name: 'Arrest Order', action: 'accuse_open_menu' });
        }
    }

    materialsList.innerHTML = '';
    materials.forEach(item => {
        const material = document.createElement('div');
        material.className = 'drawer-item';
        material.innerHTML = `
            <div class="drawer-item-icon">${item.emoji}</div>
            <div class="drawer-item-text">
                <div class="name">${item.name}</div>
            </div>
        `;
        material.onclick = () => {
            handleAction(item.action, false); // Don't close drawers
        };
        materialsList.appendChild(material);
    });
}

function renderLocationSwitcher(stageInfo) {
    const switcher = document.getElementById('locationSwitcher');
    if (!switcher) return;

    const stageNumber = stageInfo?.stage || window.currentStageNumber || 1;
    const locations = Array.isArray(stageInfo?.locations) ? stageInfo.locations : [];
    const visibleLocations = locations.filter(loc => loc?.switcher_visible !== false && !!loc?.action);

    if (stageNumber <= 1 || visibleLocations.length <= 1) {
        switcher.style.display = 'none';
        switcher.innerHTML = '';
        return;
    }

    switcher.innerHTML = '';
    visibleLocations.forEach((location, index) => {
        const tab = document.createElement('div');
        tab.className = `location-switcher-tab${location.current ? ' active' : ''}`;
        tab.setAttribute('role', 'button');
        tab.setAttribute('tabindex', location.current ? '-1' : '0');
        tab.setAttribute('aria-pressed', location.current ? 'true' : 'false');
        tab.setAttribute('aria-label', `Switch to ${location.name}`);

        const bg = document.createElement('div');
        bg.className = 'location-switcher-bg';
        const textureUrl = buildImageUrl(location.texture_image);
        if (textureUrl) {
            bg.style.backgroundImage = `url('${textureUrl}')`;
        } else {
            bg.classList.add('fallback');
        }

        const label = document.createElement('div');
        label.className = 'location-switcher-label';
        label.textContent = location.name || 'Location';

        tab.appendChild(bg);
        tab.appendChild(label);

        const activateLocation = () => {
            if (location.current || !location.action) return;
            handleAction(location.action);
        };
        tab.onclick = activateLocation;
        tab.onkeydown = (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                activateLocation();
            }
        };

        switcher.appendChild(tab);

        if (index < visibleLocations.length - 1) {
            const divider = document.createElement('div');
            divider.className = 'location-switcher-divider';
            switcher.appendChild(divider);
        }
    });

    switcher.style.display = 'flex';
}

// Horizontal Menu functions
function toggleHorizontalMenu() {
    const menu = document.getElementById('horizontalMenu');
    const button = document.getElementById('burgerButton');
    menu.classList.toggle('active');
    button.classList.toggle('active');
}

function handleMenuAction(action) {
    toggleHorizontalMenu();
    if (action === 'help') {
        showTutorial();
    } else {
        handleAction(action);
    }
}

// Image modal functions
function openImageModal(imageUrl = null) {
    const overlay = document.getElementById('imageModalOverlay');
    const content = document.getElementById('imageModalContent');
    // Image URL is required - no default header image anymore
    const resolvedUrl = buildImageUrl(imageUrl);
    if (resolvedUrl) {
        content.src = resolvedUrl;
        overlay.classList.add('active');
        // Prevent body scroll when modal is open
        document.body.style.overflow = 'hidden';
    }
}

function closeImageModal() {
    const overlay = document.getElementById('imageModalOverlay');
    overlay.classList.remove('active');
    // Restore body scroll
    document.body.style.overflow = '';
}

function resolveCharacterProfileData(character) {
    const characterStatuses = {
        tim: 'PhD candidate. Finance. Options pricing.',
        ronnie: 'MBA. Investor. Family man.',
        fiona: 'MS Biology @ UChicago.',
        pauline: 'Independent consultant. Turning good ideas into better returns.',
        susan: 'Ask dumb questions. That is how you find the interesting ones.',
        james: 'Postdoc, Finance Department, University of Chicago',
        alex: 'The best ideas take time.'
    };
    const fallbackName = (character?.name || '').trim() || 'Character';
    const fallbackImage = character?.image || null;
    const stageCharacters = Array.isArray(window.currentStageCharacters) ? window.currentStageCharacters : [];
    const matchedStageCharacter = stageCharacters.find((stageCharacter) => {
        const fullName = (stageCharacter?.full_name || '').trim().toLowerCase();
        return fullName && fullName === fallbackName.toLowerCase();
    });
    const characterKey = matchedStageCharacter?.key || null;
    return {
        name: matchedStageCharacter?.full_name || fallbackName,
        image: matchedStageCharacter?.image || fallbackImage,
        privateAction: characterKey ? `talk_${characterKey}` : null,
        status: characterStatuses[characterKey] || 'Chat participant'
    };
}

function openCharacterProfile(character = {}) {
    const overlay = document.getElementById('characterProfileOverlay');
    const avatar = document.getElementById('characterProfileAvatar');
    const name = document.getElementById('characterProfileName');
    const status = document.getElementById('characterProfileStatus');
    const actions = document.querySelector('.character-profile-actions');
    const privateButton = document.getElementById('characterProfilePrivateBtn');
    const commonButton = document.getElementById('characterProfileCommonBtn');
    if (!overlay || !avatar || !name || !status || !actions || !privateButton || !commonButton) {
        return;
    }

    const profileData = resolveCharacterProfileData(character);
    const profileImageUrl = buildImageUrl(profileData.image);
    avatar.src = profileImageUrl || '';
    avatar.alt = profileData.name;
    avatar.style.display = profileImageUrl ? 'block' : 'none';
    name.textContent = profileData.name;
    status.textContent = profileData.status;
    const isAlreadyInPrivateWithCharacter = Boolean(
        currentCharacter &&
        typeof currentCharacter.name === 'string' &&
        currentCharacter.name.trim().toLowerCase() === profileData.name.trim().toLowerCase()
    );
    actions.style.display = isAlreadyInPrivateWithCharacter ? 'none' : 'flex';

    const isMobile = window.innerWidth <= 767;
    privateButton.disabled = !profileData.privateAction;
    privateButton.onclick = async () => {
        if (!profileData.privateAction) return;
        closeCharacterProfile();
        await handleAction(profileData.privateAction, !isMobile);
    };

    commonButton.onclick = async () => {
        closeCharacterProfile();
        await handleAction('mode_public', !isMobile);
    };

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeCharacterProfile() {
    const overlay = document.getElementById('characterProfileOverlay');
    if (!overlay) return;
    overlay.classList.remove('active');
    document.body.style.overflow = '';
}

function applyEp1CaseClosedUi() {
    if (typeof populateCharactersDrawer === 'function') populateCharactersDrawer();
    if (typeof populateCaseMaterialsDrawer === 'function') populateCaseMaterialsDrawer();
    if (typeof updatePrivateModeControls === 'function') updatePrivateModeControls();
}

// Export to window
window.toggleLeftDrawer = toggleLeftDrawer;
window.openLeftDrawer = openLeftDrawer;
window.closeLeftDrawer = closeLeftDrawer;
window.toggleRightDrawer = toggleRightDrawer;
window.openRightDrawer = openRightDrawer;
window.closeRightDrawer = closeRightDrawer;
window.closeRightDrawerDetail = closeRightDrawerDetail;
window.backToClueList = backToClueList;
window.showClueDetail = showClueDetail;
window.closeAllDrawers = closeAllDrawers;
window.checkAndCloseOverlay = checkAndCloseOverlay;
window.populateCharactersDrawer = populateCharactersDrawer;
window.populateCaseMaterialsDrawer = populateCaseMaterialsDrawer;
window.renderLocationSwitcher = renderLocationSwitcher;
window.toggleHorizontalMenu = toggleHorizontalMenu;
window.handleMenuAction = handleMenuAction;
window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;
window.openCharacterProfile = openCharacterProfile;
window.closeCharacterProfile = closeCharacterProfile;
window.setActiveCharacterDrawerItem = setActiveCharacterDrawerItem;
window.updatePrivateModeControls = updatePrivateModeControls;
window.backToCommonDialogue = backToCommonDialogue;
window.addMessage = addMessage;
window.showTypingIndicator = showTypingIndicator;
window.escapeHtml = escapeHtml;
window.renderMarkdown = renderMarkdown;
window.renderTypewriterText = renderTypewriterText;
window.autoResizeTextarea = autoResizeTextarea;
window.getActiveChatScope = getActiveChatScope;
window.applyChatScopeVisibility = applyChatScopeVisibility;
window.applyEp1CaseClosedUi = applyEp1CaseClosedUi;
