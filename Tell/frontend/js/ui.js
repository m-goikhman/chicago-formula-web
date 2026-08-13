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

const EP3_SCRIPTED_LOCATIONS = {
    university_ep3: 'james',
    alex_apartment_ep3: 'alex',
    university_ep2: 'james',
};

function getCurrentStageLocationKey() {
    if (window.currentStageLocation) {
        return window.currentStageLocation;
    }
    const locations = window.currentStageLocations || [];
    const current = locations.find((loc) => loc.current);
    return current?.key || null;
}

function getEp2ScriptedWitnessKey() {
    if (Number(window.currentStageNumber || 1) !== 3) {
        return null;
    }
    const locationKey = getCurrentStageLocationKey();
    return EP3_SCRIPTED_LOCATIONS[locationKey] || null;
}

function isEp4HubLocationKey(locationKey) {
    const hubKeys = Array.isArray(window.EP4_HUB_LOCATION_KEYS) ? window.EP4_HUB_LOCATION_KEYS : [];
    return hubKeys.includes(String(locationKey || '').trim());
}

function isEp4HubNavigationActive() {
    if (Number(window.currentStageNumber || 1) !== 4 || !window.ep4NinaChatAvailable) {
        return false;
    }
    return isEp4HubLocationKey(getCurrentStageLocationKey());
}

function getEp4HubSwitchableLocations() {
    if (!isEp4HubNavigationActive()) {
        return [];
    }

    const currentKey = getCurrentStageLocationKey();
    const locations = Array.isArray(window.currentStageLocations) ? window.currentStageLocations : [];
    let switchable = locations.filter((loc) => (
        isEp4HubLocationKey(loc?.key)
        && loc?.switcher_visible !== false
        && !!loc?.action
    ));

    if (switchable.length <= 1 && typeof window.EP4_HUB_LOCATION_FALLBACK === 'object') {
        switchable = Object.entries(window.EP4_HUB_LOCATION_FALLBACK).map(([key, cfg]) => ({
            key,
            name: cfg.name,
            action: cfg.action,
            texture_image: cfg.texture_image,
            location_image: cfg.location_image,
            switcher_visible: true,
            current: key === currentKey,
        }));
    }

    return switchable;
}

function episodeUsesLocationNavigation() {
    const stage = Number(window.currentStageNumber || 1);
    const locations = Array.isArray(window.currentStageLocations) ? window.currentStageLocations : [];
    if (stage === 4 && (isEp4HubNavigationActive() || getCurrentStageLocationKey())) {
        return true;
    }
    return (stage === 3 || stage === 4) && locations.length > 0;
}

function getSwitchableStageLocations() {
    const stage = Number(window.currentStageNumber || 1);
    if (stage === 4) {
        return getEp4HubSwitchableLocations();
    }
    if (!episodeUsesLocationNavigation()) {
        return [];
    }
    const locations = Array.isArray(window.currentStageLocations) ? window.currentStageLocations : [];
    return locations.filter((loc) => loc?.switcher_visible !== false && !!loc?.action);
}

function getEp2SwitchableLocations() {
    return getSwitchableStageLocations();
}

function getCurrentStageLocation() {
    const locationKey = getCurrentStageLocationKey();
    const locations = Array.isArray(window.currentStageLocations) ? window.currentStageLocations : [];
    if (locationKey) {
        const matched = locations.find((loc) => loc.key === locationKey);
        if (matched) {
            return matched;
        }
        const fallback = window.EP4_HUB_LOCATION_FALLBACK?.[locationKey];
        if (fallback) {
            return {
                key: locationKey,
                ...fallback,
                current: true,
            };
        }
    }
    return locations.find((loc) => loc.current) || null;
}

function getCurrentEp2Location() {
    return getCurrentStageLocation();
}

function shouldShowLocationHeader() {
    const navigationBar = document.getElementById('navigationBar');
    const hasInvestigationStarted = Boolean(navigationBar && navigationBar.style.display !== 'none');
    const stage = Number(window.currentStageNumber || 1);
    if (!hasInvestigationStarted || !episodeUsesLocationNavigation()) {
        return false;
    }
    if (stage === 3) {
        if (Boolean(window.ep3GameCompleted)) {
            return false;
        }
        const switchableLocations = getSwitchableStageLocations();
        const hasExitAction = switchableLocations.some((loc) => loc?.action === 'ep3_head_out');
        return Boolean(getEp2ScriptedWitnessKey()) && (switchableLocations.length > 1 || hasExitAction);
    }
    if (stage === 4) {
        if (Boolean(window.ep4GameCompleted)) {
            return false;
        }
        if (!isEp4HubNavigationActive()) {
            return false;
        }
        const inputArea = document.getElementById('inputArea');
        const isInputVisible = Boolean(inputArea && inputArea.style.display !== 'none');
        return Boolean(getCurrentStageLocationKey()) && (hasInvestigationStarted || isInputVisible);
    }
    return false;
}

function shouldShowLocationDropdown() {
    const stage = Number(window.currentStageNumber || 1);
    if (stage === 4) {
        if (!isEp4HubNavigationActive()) {
            return false;
        }
        return getEp4HubSwitchableLocations().length > 1;
    }
    if (!shouldShowLocationHeader()) {
        return false;
    }
    if (stage === 3) {
        const switchableLocations = getSwitchableStageLocations();
        return switchableLocations.length > 1
            || switchableLocations.some((loc) => loc?.action === 'ep3_head_out');
    }
    return false;
}

function shouldShowEp2LocationHeader() {
    return shouldShowLocationHeader();
}

function closeLocationHeaderDropdown() {
    if (window.locationSwitcherTutorialLock) {
        return;
    }
    const context = document.getElementById('chatModeHeaderContext');
    if (context) {
        context.classList.remove('dropdown-open');
        context.setAttribute('aria-expanded', 'false');
    }
    const dropdown = document.getElementById('locationHeaderDropdown');
    if (dropdown) {
        dropdown.style.display = 'none';
    }
}

function toggleLocationHeaderDropdown(event) {
    if (!shouldShowLocationDropdown()) {
        return;
    }
    if (event) {
        event.stopPropagation();
    }
    const context = document.getElementById('chatModeHeaderContext');
    const dropdown = document.getElementById('locationHeaderDropdown');
    if (!context || !dropdown) {
        return;
    }
    const isOpen = context.classList.contains('dropdown-open');
    if (isOpen) {
        closeLocationHeaderDropdown();
        return;
    }
    context.classList.add('dropdown-open');
    context.setAttribute('aria-expanded', 'true');
    dropdown.style.display = 'block';
}

function renderLocationHeaderDropdown() {
    const context = document.getElementById('chatModeHeaderContext');
    const dropdown = document.getElementById('locationHeaderDropdown');
    if (!context || !dropdown) {
        return;
    }

    if (!shouldShowLocationHeader() && !isEp4HubNavigationActive()) {
        closeLocationHeaderDropdown();
        dropdown.innerHTML = '';
        context.classList.remove('has-location-dropdown');
        return;
    }

    const hasDropdown = shouldShowLocationDropdown();
    context.classList.toggle('has-location-dropdown', hasDropdown);
    if (!hasDropdown) {
        closeLocationHeaderDropdown();
        dropdown.innerHTML = '';
        return;
    }

    const stage = Number(window.currentStageNumber || 1);
    const locations = stage === 4 ? getEp4HubSwitchableLocations() : getSwitchableStageLocations();
    dropdown.innerHTML = '';
    locations.forEach((location) => {
        const item = document.createElement('div');
        item.className = 'location-header-dropdown-item';
        item.setAttribute('role', 'menuitem');
        if (location.current) {
            item.classList.add('current');
            item.setAttribute('aria-current', 'true');
        }

        const imagePath = location.location_image || location.texture_image;
        const imageUrl = buildImageUrl(imagePath);
        if (imageUrl) {
            const thumb = document.createElement('img');
            thumb.className = 'location-header-dropdown-thumb';
            thumb.src = imageUrl;
            thumb.alt = '';
            thumb.loading = 'lazy';
            item.appendChild(thumb);
        }

        const label = document.createElement('span');
        label.className = 'location-header-dropdown-name';
        label.textContent = location.name || 'Location';
        item.appendChild(label);

        if (!location.current && location.action) {
            item.onclick = (event) => {
                event.stopPropagation();
                closeLocationHeaderDropdown();
                handleAction(location.action);
            };
        }

        dropdown.appendChild(item);
    });
}

function buildCharactersDrawerList(stageChars) {
    const witnessKey = getEp2ScriptedWitnessKey();
    if (witnessKey) {
        const witness = stageChars.find((character) => character.key === witnessKey);
        const privateCharacters = stageChars.filter((character) => character.key !== witnessKey);
        const list = [];
        if (witness) {
            list.push({
                name: witness.full_name,
                status: 'Together with Nina Reyes',
                action: 'mode_public',
                image: witness.image,
            });
        }
        return list.concat(
            privateCharacters.map((character) => ({
                name: character.full_name,
                status: 'Private Chat',
                action: `talk_${character.key}`,
                image: character.image,
            }))
        );
    }

    const privateCharacters = stageChars.length > 0
        ? stageChars.map((character) => ({
            name: character.full_name,
            status: 'Private Chat',
            action: `talk_${character.key}`,
            image: character.image,
        }))
        : [
            { name: 'Tim Kane', status: 'Private Chat', action: 'talk_tim', image: 'ep1/tim.png' },
            { name: 'Ronnie Snapper', status: 'Private Chat', action: 'talk_ronnie', image: 'ep1/ronnie.png' },
            { name: 'Fiona McAllister', status: 'Private Chat', action: 'talk_fiona', image: 'ep1/fiona.png' },
            { name: 'Pauline Thompson', status: 'Private Chat', action: 'talk_pauline', image: 'ep1/pauline.png' }
        ];
    return (privateCharacters.length > 1
        ? [{ name: 'Everyone', status: 'Public Chat', action: 'mode_public', image: null }]
        : []
    ).concat(privateCharacters);
}

// Populate characters drawer (uses current episode's characters from API when available)
function populateCharactersDrawer() {
    const charactersList = document.getElementById('charactersList');
    if (!charactersList) return;
    
    // Use current episode's characters from API, or fallback to ep1 list for first paint / restore
    const stageChars = window.currentStageCharacters || [];
    const list = buildCharactersDrawerList(stageChars);

    const stageNum = Number(window.currentStageNumber || 1);
    const ep1PartyClosed = stageNum === 1 && Boolean(window.ep1PartyCompleted);
    const ep2CaseClosed = stageNum === 2 && Boolean(window.ep1GameCompleted);
    const ep3CaseClosed = stageNum === 3 && Boolean(window.ep3GameCompleted);
    const ep4CaseClosed = stageNum === 4 && Boolean(window.ep4GameCompleted);
    const ep1CaseClosed = ep1PartyClosed || ep2CaseClosed || ep3CaseClosed || ep4CaseClosed;

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
            iconHTML = char.action === 'mode_public' && !characterImageUrl
                ? '💬'
                : `<span class="drawer-item-initial">${(char.name || '?')[0]}</span>`;
        }
        
        const keyFromAction = String(char.action || '').toLowerCase().startsWith('talk_')
            ? String(char.action).slice(5).toLowerCase()
            : null;
        if (keyFromAction) {
            item.dataset.characterKey = keyFromAction;
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
                
                if (char.action === 'mode_public') {
                    currentCharacter = null;
                } else {
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

function setActiveCharacterDrawerItem(characterName = null, characterKey = null) {
    const drawerItems = document.querySelectorAll('#charactersList .drawer-item');
    if (!drawerItems.length) return;

    drawerItems.forEach((item) => item.classList.remove('active'));

    const normalizedTarget = (characterName || '').trim().toLowerCase();
    const normalizedKey = (characterKey || '').trim().toLowerCase();
    const targetItem = Array.from(drawerItems).find((item) => {
        if (normalizedKey && item.dataset.characterKey === normalizedKey) {
            return true;
        }
        const itemName = (item.querySelector('.name')?.textContent || '').trim().toLowerCase();
        if (normalizedTarget) {
            return itemName === normalizedTarget;
        }
        return item.classList.contains('chat-target-public');
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
    if (!drawerName) {
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
        const isNarratorMessage = messageElement.classList.contains('narrator-message');
        const scope = (messageElement.dataset.chatScope || 'public').trim().toLowerCase();
        const isPrivateMessage = scope.startsWith('private:');
        let shouldHideByScope = activeScope === 'public'
            ? isPrivateMessage
            : scope !== activeScope;
        if (isNarratorMessage) {
            shouldHideByScope = false;
        }

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
    const activeDrawer = document.querySelector('#charactersList .drawer-item.active');
    const activeDrawerNameRaw = (
        activeDrawer?.querySelector('.name')?.textContent || ''
    ).trim();
    const activeDrawerName = activeDrawerNameRaw.toLowerCase();
    const isPublicDrawerActive = Boolean(activeDrawer?.classList.contains('chat-target-public'));
    const activeCharacterNameRaw = (currentCharacter?.name || '').trim();
    const activeCharacterName = activeCharacterNameRaw.toLowerCase();
    const isPrivateModeActive = Boolean(
        activeCharacterName &&
        !isPublicDrawerActive &&
        activeDrawerName &&
        activeDrawerName === activeCharacterName
    );
    const stageCharacters = Array.isArray(window.currentStageCharacters) ? window.currentStageCharacters : [];
    const privateCharacterLabel = activeCharacterNameRaw || activeDrawerNameRaw;
    const ep2WitnessKey = getEp2ScriptedWitnessKey();
    const ep2Witness = ep2WitnessKey
        ? stageCharacters.find((character) => character.key === ep2WitnessKey)
        : null;
    const publicAvatarUrl = buildImageUrl('ep1/suspects.png');
    const ep2PublicAvatarUrl = buildImageUrl(ep2Witness?.image);
    const privateAvatarUrl = buildImageUrl(currentCharacter?.image);
    const currentStage = Number(window.currentStageNumber || 1);
    const navigationBar = document.getElementById('navigationBar');
    const hasInvestigationStarted = Boolean(navigationBar && navigationBar.style.display !== 'none');
    const shouldShowEp1PublicAvatar = (currentStage === 1 || currentStage === 2) && hasInvestigationStarted;
    const shouldShowEp2PublicAvatar = Boolean(ep2Witness && hasInvestigationStarted);
    const isLocationHeader = shouldShowLocationHeader();
    const isEp4HubNavigation = isEp4HubNavigationActive();
    const treatAsLocationHeader = isLocationHeader || isEp4HubNavigation;
    const hasLocationDropdown = shouldShowLocationDropdown();
    const currentStageLocation = getCurrentStageLocation();
    const singleLocationCharacter = currentStage === 4 && stageCharacters.length === 1
        ? stageCharacters[0]
        : null;
    const locationHeaderImageUrl = buildImageUrl(
        currentStageLocation?.location_image
        || currentStageLocation?.texture_image
        || singleLocationCharacter?.image
    );
    const ep1PartyClosed = currentStage === 1 && Boolean(window.ep1PartyCompleted);
    const ep2CaseClosed = currentStage === 2 && Boolean(window.ep1GameCompleted);
    const ep3CaseClosed = currentStage === 3 && Boolean(window.ep3GameCompleted);
    const ep4CaseClosed = currentStage === 4 && Boolean(window.ep4GameCompleted);
    const ep1CaseClosed = ep1PartyClosed || ep2CaseClosed || ep3CaseClosed || ep4CaseClosed;
    const publicModeLabel = ep2Witness
        ? 'Together with Nina Reyes'
        : 'Public chat (Everyone)';

    privateModeControls.style.display = isPrivateModeActive && isInputVisible ? 'flex' : 'none';
    if (backToCommonDialogueBtn) {
        backToCommonDialogueBtn.classList.toggle('is-private', isPrivateModeActive);
        backToCommonDialogueBtn.style.display = isEp4HubNavigation ? 'none' : '';
    }
    if (headerContextAvatar) {
        const avatarSrc = treatAsLocationHeader && locationHeaderImageUrl
            ? locationHeaderImageUrl
            : (isPrivateModeActive && privateAvatarUrl && !treatAsLocationHeader
                ? privateAvatarUrl
                : (shouldShowEp2PublicAvatar && ep2PublicAvatarUrl
                    ? ep2PublicAvatarUrl
                    : (shouldShowEp1PublicAvatar ? publicAvatarUrl : null)));
        if (avatarSrc) {
            headerContextAvatar.src = avatarSrc;
            headerContextAvatar.style.display = 'block';
            headerContextAvatar.alt = treatAsLocationHeader
                ? (currentStageLocation?.name || 'Current location')
                : (isPrivateModeActive
                    ? `${privateCharacterLabel} avatar`
                    : (ep2Witness ? `${ep2Witness.full_name} avatar` : 'Group chat avatar'));
        } else {
            headerContextAvatar.src = '';
            headerContextAvatar.alt = '';
            headerContextAvatar.style.display = 'none';
        }
    }
    if (headerModeContext) {
        const shouldShowHeaderContext = !isLoginVisible && Boolean(
            (treatAsLocationHeader && (locationHeaderImageUrl || currentStageLocation?.name))
            || (isPrivateModeActive && privateAvatarUrl && !treatAsLocationHeader)
            || (!isPrivateModeActive && (shouldShowEp1PublicAvatar || shouldShowEp2PublicAvatar))
        );
        headerModeContext.style.display = shouldShowHeaderContext ? 'inline-flex' : 'none';
        headerModeContext.classList.toggle(
            'is-private',
            isPrivateModeActive && !treatAsLocationHeader
        );
        headerModeContext.classList.toggle('has-location-dropdown', hasLocationDropdown);
        headerModeContext.title = treatAsLocationHeader
            ? `Current location: ${currentStageLocation?.name || 'Location'}`
            : (isPrivateModeActive
                ? `Private chat with ${privateCharacterLabel}`
                : publicModeLabel);
        if (hasLocationDropdown) {
            headerModeContext.style.cursor = 'pointer';
            headerModeContext.setAttribute('role', 'button');
            headerModeContext.setAttribute('aria-haspopup', 'menu');
            headerModeContext.setAttribute('aria-expanded', headerModeContext.classList.contains('dropdown-open') ? 'true' : 'false');
            headerModeContext.onclick = toggleLocationHeaderDropdown;
        } else {
            headerModeContext.style.cursor = '';
            headerModeContext.removeAttribute('role');
            headerModeContext.removeAttribute('aria-haspopup');
            headerModeContext.removeAttribute('aria-expanded');
            headerModeContext.onclick = null;
            closeLocationHeaderDropdown();
        }
    }
    renderLocationHeaderDropdown();
    if (typeof window.maybeShowLocationSwitcherTutorial === 'function') {
        window.maybeShowLocationSwitcherTutorial();
    }
    if (inputElement) {
        if (ep1CaseClosed && isInputVisible) {
            inputElement.disabled = true;
            inputElement.placeholder = 'The case is closed — you can read the chat above.';
        } else {
            inputElement.disabled = false;
            if (isInputVisible) {
                const singleLocationPartner = !isPrivateModeActive
                    && currentStage === 4
                    && stageCharacters.length === 1
                    ? stageCharacters[0].full_name
                    : null;
                inputElement.placeholder = isPrivateModeActive
                    ? `Message ${privateCharacterLabel}...`
                    : (ep2Witness
                        ? `Message ${ep2Witness.full_name}...`
                        : (singleLocationPartner
                            ? `Message ${singleLocationPartner}...`
                            : 'Type a message to everyone...'));
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
function getExaminedCluesSet() {
    if (window.cluesExamined instanceof Set) {
        return window.cluesExamined;
    }
    const fromList = Array.isArray(window.cluesExamined) ? window.cluesExamined : [];
    window.cluesExamined = new Set(fromList.map((item) => String(item)));
    return window.cluesExamined;
}

function setExaminedClues(list) {
    window.cluesExamined = new Set((Array.isArray(list) ? list : []).map((item) => String(item)));
    updateCaseMaterialsBadge();
}

function evidenceKeyFromExamineAction(action) {
    const normalized = String(action || '').trim();
    let match = normalized.match(/^examine_(?:ep\d+_)?clue_(\d+)$/i);
    if (match) {
        return match[1];
    }
    match = normalized.match(/^examine_ep4_material_(.+)$/i);
    if (match) {
        return match[1];
    }
    return null;
}

function markCaseMaterialExamined(evidenceKey) {
    if (!evidenceKey) {
        return;
    }
    getExaminedCluesSet().add(String(evidenceKey));
    updateCaseMaterialsBadge();
}

function getCurrentCaseMaterials() {
    const currentStage = window.currentStageNumber || 1;
    const partyClueMaterials = (includeUsb) => {
        const base = [
            { emoji: '🔍', name: 'Med Report & Personal Items', action: 'examine_clue_1', evidenceKey: '1' },
            { emoji: '🔍', name: 'The Weapon', action: 'examine_clue_2', evidenceKey: '2' },
            { emoji: '🔍', name: 'The Note', action: 'examine_clue_3', evidenceKey: '3' }
        ];
        if (includeUsb) {
            return [{ emoji: '🔍', name: 'The USB Drive', action: 'examine_clue_4', evidenceKey: '4' }, ...base];
        }
        return base;
    };
    const showAccusationButton = currentStage === 1 || currentStage === 2;
    let materials;
    if (currentStage === 3) {
        materials = [{ emoji: '🔍', name: 'The Formula', action: 'examine_ep3_clue_1', evidenceKey: '1' }];
    } else if (currentStage === 2) {
        materials = partyClueMaterials(Boolean(window.ep1UsbDriveUnlocked));
    } else if (currentStage === 1) {
        materials = partyClueMaterials(false);
    } else if (currentStage === 4) {
        const caseMaterials = getCurrentStageLocation()?.case_materials || [];
        materials = caseMaterials
            .filter((item) => item?.id && item?.name)
            .map((item) => ({
                emoji: '🔍',
                name: item.name,
                action: `examine_ep4_material_${item.id}`,
                evidenceKey: String(item.id),
            }));
    } else {
        materials = [];
    }

    const ep1AccusationClosed = currentStage === 1 && Boolean(window.ep1PartyCompleted);
    const ep2AccusationClosed = currentStage === 2 && Boolean(window.ep1GameCompleted);
    const accusationClosed = ep1AccusationClosed || ep2AccusationClosed;
    if (showAccusationButton && !accusationClosed) {
        if (Array.isArray(materials)) {
            materials.push({ emoji: '⚖️', name: 'Arrest Order', action: 'accuse_open_menu' });
        }
    }
    return materials;
}

function getUnviewedCaseMaterialsCount() {
    const examined = getExaminedCluesSet();
    return getCurrentCaseMaterials().filter((item) => {
        if (!item?.evidenceKey) {
            return false;
        }
        return !examined.has(String(item.evidenceKey));
    }).length;
}

function updateCaseMaterialsBadge() {
    const badge = document.getElementById('caseMaterialsBadge');
    if (!badge) {
        return;
    }
    const count = getUnviewedCaseMaterialsCount();
    if (count > 0) {
        badge.textContent = String(count);
        badge.hidden = false;
        badge.setAttribute('aria-hidden', 'false');
        badge.setAttribute('aria-label', `${count} unviewed`);
    } else {
        badge.textContent = '0';
        badge.hidden = true;
        badge.setAttribute('aria-hidden', 'true');
        badge.removeAttribute('aria-label');
    }
}

function populateCaseMaterialsDrawer() {
    const materialsList = document.getElementById('caseMaterialsList');
    const materials = getCurrentCaseMaterials();

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
            // Close the list; first view lands in chat, re-examine reopens the detail drawer.
            handleAction(item.action, true);
        };
        materialsList.appendChild(material);
    });
    updateCaseMaterialsBadge();
}

function renderLocationSwitcher() {
    const switcher = document.getElementById('locationSwitcher');
    if (!switcher) return;
    switcher.style.display = 'none';
    switcher.innerHTML = '';
    if (typeof updatePrivateModeControls === 'function') {
        updatePrivateModeControls();
    }
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

function isEp2ScriptedWitnessCharacter(characterKey, characterName = '') {
    const witnessKey = getEp2ScriptedWitnessKey();
    if (!witnessKey) {
        return false;
    }
    const normalizedKey = (characterKey || '').trim().toLowerCase();
    if (normalizedKey && normalizedKey === witnessKey) {
        return true;
    }
    const stageCharacters = Array.isArray(window.currentStageCharacters) ? window.currentStageCharacters : [];
    const witness = stageCharacters.find((stageCharacter) => stageCharacter.key === witnessKey);
    const witnessName = (witness?.full_name || '').trim().toLowerCase();
    const normalizedName = (characterName || '').trim().toLowerCase();
    return Boolean(witnessName && normalizedName && witnessName === normalizedName);
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
    const explicitKey = (character?.key || '').trim().toLowerCase();
    const stageCharacters = Array.isArray(window.currentStageCharacters) ? window.currentStageCharacters : [];
    const matchedStageCharacter = stageCharacters.find((stageCharacter) => {
        const stageKey = (stageCharacter?.key || '').trim().toLowerCase();
        if (explicitKey && stageKey === explicitKey) {
            return true;
        }
        const fullName = (stageCharacter?.full_name || '').trim().toLowerCase();
        return fullName && fullName === fallbackName.toLowerCase();
    });
    const characterKey = matchedStageCharacter?.key || explicitKey || null;
    const hidePrivateChat = isEp2ScriptedWitnessCharacter(characterKey, fallbackName);
    const privateAction = hidePrivateChat
        ? null
        : (characterKey ? `talk_${characterKey}` : null);
    return {
        name: matchedStageCharacter?.full_name || fallbackName,
        image: matchedStageCharacter?.image || fallbackImage,
        privateAction,
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
    const showPrivateButton = Boolean(profileData.privateAction);
    privateButton.style.display = showPrivateButton ? '' : 'none';
    privateButton.disabled = !showPrivateButton;
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
window.updateCaseMaterialsBadge = updateCaseMaterialsBadge;
window.setExaminedClues = setExaminedClues;
window.markCaseMaterialExamined = markCaseMaterialExamined;
window.evidenceKeyFromExamineAction = evidenceKeyFromExamineAction;
window.renderLocationSwitcher = renderLocationSwitcher;
window.renderLocationHeaderDropdown = renderLocationHeaderDropdown;
window.closeLocationHeaderDropdown = closeLocationHeaderDropdown;
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
