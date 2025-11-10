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

function showClueDetail(clueId, content, imageUrl) {
    // Hide the list drawer
    const listDrawer = document.getElementById('rightDrawer');
    listDrawer.classList.remove('open');
    
    // Show the detail drawer
    const detailDrawer = document.getElementById('rightDrawerDetail');
    const title = document.getElementById('detailTitle');
    const contentDiv = document.getElementById('clueDetailContent');
    
    title.textContent = `🔍 Clue ${clueId}`;
    
    let html = '';
    const clueImageUrl = buildImageUrl(imageUrl);
    if (clueImageUrl) {
        html += `<img src="${clueImageUrl}" alt="Clue ${clueId}" class="clue-detail-image" loading="lazy" onclick="openImageModal('${imageUrl}')" />`;
    }
    html += `<div class="clue-detail-text">${renderMarkdown(content)}</div>`;
    
    contentDiv.innerHTML = html;
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

// Populate characters drawer
function populateCharactersDrawer() {
    const charactersList = document.getElementById('charactersList');
    const characters = [
        { emoji: '💬', name: 'Everyone', status: 'Public Chat', action: 'mode_public', image: null },
        { emoji: '📚', name: 'Tim Kane', status: 'Private Chat', action: 'talk_tim', image: 'tim.png' },
        { emoji: '😎', name: 'Ronnie Snapper', status: 'Private Chat', action: 'talk_ronnie', image: 'ronnie.png' },
        { emoji: '💔', name: 'Fiona McAllister', status: 'Private Chat', action: 'talk_fiona', image: 'fiona.png' },
        { emoji: '💼', name: 'Pauline Thompson', status: 'Private Chat', action: 'talk_pauline', image: 'pauline.png' }
    ];

    charactersList.innerHTML = '';
    characters.forEach(char => {
        const item = document.createElement('div');
        item.className = 'drawer-item';
        // Use image if available, otherwise use emoji
        let iconHTML = '';
        const characterImageUrl = buildImageUrl(char.image);
        if (characterImageUrl) {
            iconHTML = `<img src="${characterImageUrl}" alt="${char.name}" loading="lazy" />`;
        } else {
            iconHTML = char.emoji;
        }
        
        item.innerHTML = `
            <div class="drawer-item-icon">${iconHTML}</div>
            <div class="drawer-item-text">
                <div class="name">${char.name}</div>
                <div class="status">${char.status}</div>
            </div>
        `;
        item.onclick = async () => {
            // Highlight active item
            document.querySelectorAll('.drawer-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            
            // Update current character
            if (char.name === 'Everyone') {
                currentCharacter = null; // Public chat
            } else {
                currentCharacter = {
                    name: char.name,
                    image: char.image
                };
            }
            
            // Close drawer before handling action on mobile for better UX
            const isMobile = window.innerWidth <= 767;
            if (isMobile) {
                closeLeftDrawer();
            }
            
            // Handle the action - on mobile drawer is already closed
            await handleAction(char.action, !isMobile); // Close drawer on desktop, already closed on mobile
        };
        charactersList.appendChild(item);
    });
}

// Populate case materials drawer
function populateCaseMaterialsDrawer() {
    const materialsList = document.getElementById('caseMaterialsList');
    const materials = [
        { emoji: '🔍', name: 'Med Report & Personal Items', action: 'examine_clue_1' },
        { emoji: '🔍', name: 'The Weapon', action: 'examine_clue_2' },
        { emoji: '🔍', name: 'The Note', action: 'examine_clue_3' },
        { emoji: '🔍', name: 'The Apartment', action: 'examine_clue_4' }
    ];

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

// Export to window
window.toggleLeftDrawer = toggleLeftDrawer;
window.closeLeftDrawer = closeLeftDrawer;
window.toggleRightDrawer = toggleRightDrawer;
window.closeRightDrawer = closeRightDrawer;
window.closeRightDrawerDetail = closeRightDrawerDetail;
window.backToClueList = backToClueList;
window.showClueDetail = showClueDetail;
window.closeAllDrawers = closeAllDrawers;
window.checkAndCloseOverlay = checkAndCloseOverlay;
window.populateCharactersDrawer = populateCharactersDrawer;
window.populateCaseMaterialsDrawer = populateCaseMaterialsDrawer;
window.toggleHorizontalMenu = toggleHorizontalMenu;
window.handleMenuAction = handleMenuAction;
window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;
window.addMessage = addMessage;
window.showTypingIndicator = showTypingIndicator;
window.escapeHtml = escapeHtml;
window.renderMarkdown = renderMarkdown;
window.renderTypewriterText = renderTypewriterText;
window.autoResizeTextarea = autoResizeTextarea;
